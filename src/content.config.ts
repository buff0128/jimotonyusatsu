import { defineCollection } from 'astro:content';
import type { Loader } from 'astro/loaders';
import { z } from 'astro/zod';
import { PLACEHOLDERS } from './lib/site';

// 固定ページと解説記事（docs/content/**/*.md）。URL は各ファイルの frontmatter の path。
// 本文の {{キー}} は src/lib/site.ts の PLACEHOLDERS で置き換えてから Markdown を描画する。
// Vite の import.meta.glob で生の Markdown を読む（パスはこのファイルからの相対）
const SOURCES = import.meta.glob<string>('../docs/content/**/*.md', { query: '?raw', import: 'default', eager: true });

const pagesLoader: Loader = {
  name: 'docs-content',
  async load({ store, parseData, renderMarkdown, generateDigest }) {
    store.clear();
    for (const [path, source] of Object.entries(SOURCES)) {
      const file = path.replace(/^\.\.\//, '');
      const { frontmatter, body } = splitFrontmatter(source);
      const id = file.replace(/^docs\/content\//, '').replace(/\.md$/, '');
      const data = await parseData({ id, data: frontmatter, filePath: file });
      const filled = fillPlaceholders(body);
      store.set({ id, data, body: filled, filePath: file, digest: generateDigest(source), rendered: await renderMarkdown(filled) });
    }
  },
};

const pages = defineCollection({
  loader: pagesLoader,
  schema: z.object({
    title: z.string(),
    description: z.string(),
    path: z.string().startsWith('/'),
  }),
});

export const collections = { pages };

// ---------------------------------------------------------------------------

/** 1行1項目の単純な frontmatter（key: value）だけを扱う */
function splitFrontmatter(source: string): { frontmatter: Record<string, string>; body: string } {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: source };
  const frontmatter = Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => line.match(/^([\w-]+):\s*(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]),
  );
  return { frontmatter, body: source.slice(match[0].length) };
}

function fillPlaceholders(text: string): string {
  const values: Record<string, string> = PLACEHOLDERS;
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (all, key: string) => values[key] ?? all);
}
