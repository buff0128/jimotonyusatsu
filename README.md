# じもと入札（jimotonyusatsu）

全国の官公庁・自治体の入札案件を、案件1件＝1ページで公開する入札情報サイト。計画は [docs/PLAN.md](docs/PLAN.md)。

- 構成：Astro（SSR）＋ `@astrojs/cloudflare` ＋ Cloudflare Workers ＋ D1（バインディング `DB`）
- ステージング：https://jimotonyusatsu.ishikawa-onore.workers.dev （全ページ noindex）

## 必要なもの

- Node.js 26（`.nvmrc`。`nvm use`）
- pnpm（`pnpm install` の postinstall で `worker-configuration.d.ts` が生成される）
- `wrangler login` 済みであること（wrangler は devDependency）
- AI 抽出の資料取得に poppler（`brew install poppler`。`pdftotext` を使う）
- `.dev.vars` に `CACHE_PURGE_TOKEN=...`（同期後のキャッシュ消去用。リモートにも `wrangler secret put CACHE_PURGE_TOKEN` で同じ値）

## データの流れ

```
官公需API → data/raw/kkj/{LG}/{YYYY-MM-DD}.xml（生XML）
          → data/jimoto.sqlite（正本。スキーマは migrations/ を共用）
             ├ 業種タグ（件名キーワード）… scripts/tag-cases.mjs
             └ AI 抽出・要約 … select-ai-targets → fetch-docs → （Claude Code が読む）→ import-ai
          → D1（scripts/sync-d1.mjs で upsert → エッジキャッシュを消去）
             └ 公告文は D1 では case_descriptions に分割（1行60KB以下）。cases.description は D1 では空
          → Workers 上の Astro が SSR で表示（一覧10分・案件1時間のエッジキャッシュ）
```

茨城県の入札情報公開サービス（`pnpm fetch:ppi`）の分は、利用確認が済むまで D1 に同期しない（docs/SOURCES_IBARAKI.md）。

`data/` は gitignore 対象。

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm fetch:kkj` | 官公需APIから取得し SQLite に取り込む。既定は茨城（08）の過去14日。全国4週間の平日は `-- --lg all --days 28 --weekdays`。`--from 2026-10-22 --to 2026-11-04` も可 |
| `pnpm tag` | 件名のキーワードで業種タグを付け直す（docs/GYOSHU.md） |
| `node scripts/select-ai-targets.mjs --count 100` | AI 抽出の対象を選ぶ（締切が先の案件から、地域・種別・業種が偏らないように）→ data/ai/targets.json |
| `node scripts/fetch-docs.mjs` | 対象の公告PDF・添付を取得してテキスト化 → data/docs/{id}/text.txt |
| `node scripts/import-ai.mjs` | data/ai/results/{id}.json（AI の抽出結果）を検証して case_ai・業種タグに取り込む |
| `node scripts/fetch-kkj-history.mjs` | 統計用に過去12か月分を手元の cases_history へ（D1 には送らない。途中再開できる。全国で約5.7時間） |
| `node scripts/fetch-awards.mjs` → `node scripts/match-awards.mjs` | 調達ポータルの落札実績を取得し、調達案件番号で案件と照合（落札結果の表示・落札金額の目安に使う） |
| `sh scripts/build-og-image.sh` | OGP 画像（public/og-image.png）を docs/logo から作り直す（macOS の Chrome を使う） |
| `node scripts/build-areas.mjs <csv>` | 全国の市区町村スラッグ（migrations/0005）を生成。CSV は Geolonia 住所データ |
| `pnpm fetch:ppi` | 茨城県の入札情報公開サービス（建設工事・コンサル／物品・役務）から直近3平日分を取得（試作。D1 には同期しない。[docs/SOURCES_IBARAKI.md](docs/SOURCES_IBARAKI.md)） |
| `pnpm sync:d1` | 手元 SQLite からリモート D1 へ**差分**を送る（kkj の案件・公告文の分割・AI・業種タグ・集計テーブル）。最後にエッジキャッシュを消す。`-- --full` で全件、`-- --dry-run` で SQL を書き出すだけ。先に `pnpm db:migrate:remote` |
| `pnpm sync:d1:local` | 同上をローカル D1（`.wrangler/state`）へ |
| `node scripts/explain-queries.mjs` | サイトの主要なクエリの実行計画を表示（全件走査の確認用） |
| `pnpm db:migrate:local` / `pnpm db:migrate:remote` | D1 にマイグレーションを適用 |
| `pnpm dev` | 開発サーバー（ローカル D1 を使う） |
| `pnpm preview` | ビルド結果を workerd で確認 |
| `pnpm run deploy` | ビルドして workers.dev へデプロイ（`pnpm deploy` は pnpm 自身のコマンドなので `run` が必要） |
| `pnpm astro check` | 型チェック |
| `pnpm cf-typegen` | wrangler.jsonc からバインディングの型（worker-configuration.d.ts）を再生成 |

外部へのリクエストは常に1本ずつ。官公需APIと公告資料は1.5秒以上、茨城県PPIは2.5秒以上あけている。

## 主なファイル

- `migrations/` … D1 と手元 SQLite 共通のスキーマ（`0002` 茨城、`0005` 全国の都道府県・市区町村のスラッグ）
- `scripts/fetch-kkj.mjs` / `scripts/lib/kkj.mjs` … API取得とXMLの正規化
- `scripts/sync-d1.mjs` … D1 への同期
- `src/lib/db.ts` … D1 のクエリ
- `src/lib/gyoshu.ts` … 業種タグの体系（サイトとスクリプトで共用）
- `src/lib/site.ts` … サイト名・運営者情報などの定数（`{{運営会社名}}` などの仮置きはここ）
- `docs/content/` … 固定ページ・解説記事の Markdown（frontmatter の `path` が URL）
- `src/scripts/favorites-*.ts` … お気に入り（localStorage。/favorites、☆ボタン）
- `src/lib/labels.ts` … 参加しやすさのラベルのルール（docs/LABELS.md）
- `scripts/lib/stats.mjs` … 発注機関・地域×業種の統計（過去12か月）。結果だけを D1 の org_insights / area_tag_insights に送る
- `src/styles/global.css` … デザインの値（CSS 変数）。正本は docs/design/DESIGN.md
- `src/components/AreaDashboard.astro` / `CaseBrowser.astro` / `CaseCard.astro` … 都道府県・市区町村ページ／一覧の共通の構成／案件カード
- `src/lib/indexing.ts` … 検索エンジンに載せるページのルール（AI で公告を読んだ案件・ハブ・統計・解説記事だけをインデックス）
- `scripts/lib/description-chunks.mjs` … 公告文を D1 の上限に収まる片に分ける（case_descriptions。詳細ページはつなげて全文表示、検索も全文が対象）
- `src/pages/` … `/`、`/prefectures`、`/[pref]`、`/[pref]/[slug]`（種別 or 市区町村）、`/[pref]/gyoshu/[tag]`、`/gyoshu`、`/gyoshu/[tag]`、`/orgs/[id]`、`/search`、`/favorites`、`/cases/[id]`、固定ページ、`/guide/*`、`/api/cases`・`/api/orgs`（お気に入り用）
