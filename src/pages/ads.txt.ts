import type { APIRoute } from 'astro';
import { ADSENSE_CLIENT } from '../lib/site';

// AdSense の ads.txt。src/lib/site.ts の ADSENSE_CLIENT（ca-pub-…）が空のあいだは 404
export const GET: APIRoute = () => {
  if (!ADSENSE_CLIENT) return new Response('Not Found', { status: 404 });
  const publisherId = ADSENSE_CLIENT.replace(/^ca-/, '');
  return new Response(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
