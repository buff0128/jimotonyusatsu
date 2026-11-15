// 茨城県の入札情報公開サービス（いばらき電子入札共同利用 PPI / 茨城県電子調達システム）の
// 画面を読むための HTTP セッションと HTML パーサ。
//
// どちらも同じパッケージ（Struts 製・Shift_JIS・フレーム構成）で、
//   入口でセッション（JSESSIONID）を作る → 調達機関と業務区分を POST → 発注情報を検索（POST）
//   → 結果は iframe（KF?301FrameShow）に出る → ページ送りは ?page=N（セッション依存）
// という流れになっている。詳しくは docs/SOURCES_IBARAKI.md。

const DECODER = new TextDecoder('shift_jis');
const USER_AGENT = 'jimotonyusatsu-fetcher/0.1 (+https://jimotonyusatsu.jp)';

/** セッションが切れたときにサーバーが返すページ */
export class PpiSessionError extends Error {}

/**
 * Cookie を持ち回り、リクエストを1本ずつ・最低 intervalMs あけて送る。
 * 応答は Shift_JIS をデコードした文字列と、保存用の生バイトを返す。
 */
export class PpiSession {
  #cookies = new Map();
  #lastRequestAt = 0;
  #lastUrl = undefined;

  constructor({ baseUrl, intervalMs }) {
    this.baseUrl = baseUrl;
    this.intervalMs = intervalMs;
    this.requestCount = 0;
  }

  reset() {
    this.#cookies.clear();
    this.#lastUrl = undefined;
  }

  get(path) {
    return this.#request(path, { method: 'GET' });
  }

  /** form は ASCII のみ（日本語の値は送らない。Node には Shift_JIS エンコーダが無いため） */
  post(path, form) {
    const body = new URLSearchParams(form).toString();
    if (/[^\x20-\x7e]/.test(body)) throw new Error('POST に ASCII 以外の値が入っています');
    return this.#request(path, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  async #request(path, init) {
    await this.#throttle();
    const url = new URL(path, this.baseUrl);
    const headers = {
      'User-Agent': USER_AGENT,
      ...(this.#lastUrl && { Referer: this.#lastUrl }),
      ...(this.#cookies.size > 0 && { Cookie: [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ') }),
      ...init.headers,
    };
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    this.requestCount++;
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) this.#cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    if (res.status !== 200) throw new Error(`HTTP ${res.status} ${url}`);

    const bytes = new Uint8Array(await res.arrayBuffer());
    const html = DECODER.decode(bytes);
    this.#lastUrl = url.href;
    if (isSessionErrorPage(html)) throw new PpiSessionError(`セッション切れまたはシステムエラー: ${url.pathname}`);
    return { html, bytes };
  }

  async #throttle() {
    const wait = this.#lastRequestAt + this.intervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.#lastRequestAt = Date.now();
  }
}

// 「タイムアウト」「システムエラー」だけの短いページ（本文 600 バイト前後）
function isSessionErrorPage(html) {
  if (html.length > 2000) return false;
  const text = toText(html);
  return text.includes('タイムアウト') || text.includes('システムエラー');
}

// ---------------------------------------------------------------------------
// HTML の読み取り

/** 調達機関の選択肢 [{ code: '0201ZZZZZZ', name: '水戸市' }] */
export function parseOrgOptions(html) {
  const select = html.match(/<select name="hachukikan"[^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? '';
  return [...select.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/gi)].map((m) => ({
    code: m[1],
    name: m[2].trim(),
  }));
}

export function parseHiddenValue(html, name) {
  return html.match(new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i'))?.[1];
}

/** 検索結果の総件数（検索画面の hidden の recordNum）。検索していない状態なら undefined */
export function parseRecordNum(html) {
  const value = parseHiddenValue(html, 'recordNum');
  return value === undefined || value === '' ? undefined : Number(value);
}

/** 一覧の見出し（HTML コメント内の見出しは除く） */
export function parseListHeaders(html) {
  const visible = stripComments(html);
  return [...visible.matchAll(/<TH class=['"]TableTitle['"][^>]*>([\s\S]*?)<\/TH>/gi)].map((m) =>
    toText(m[1]).replace(/\s+/g, ''),
  );
}

/**
 * 結果フレームの各行を { controlNo, cells[] } で返す。
 * セルは JavaScript の tableFormat('値', 桁) で書かれていることがあるので、その引数を取り出す。
 */
export function parseResultRows(html) {
  const visible = stripComments(html);
  const rows = [];
  for (const tr of visible.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const controlNo = tr[1].match(/doEdit\('([^']+)'/)?.[1];
    if (!controlNo) continue;
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((td) => cellText(td[1]));
    rows.push({ controlNo, cells });
  }
  return rows;
}

function cellText(cellHtml) {
  const formatted = cellHtml.match(/tableFormat\('((?:[^'\\]|\\.)*)',\s*\d+\)/);
  if (formatted) return toText(formatted[1].replace(/\\(.)/g, '$1'));
  const money = cellHtml.match(/tagFormatMoney2?\('([^']*)'\)/);
  if (money) return money[1];
  return toText(cellHtml.replace(/<script[\s\S]*?<\/script>/gi, ''));
}

// コメントアウトされた列を落とす。<script> の中身も <!-- --> で囲まれているので、script の外だけを対象にする
function stripComments(html) {
  return html
    .split(/(<script[\s\S]*?<\/script>)/i)
    .map((part) => (/^<script/i.test(part) ? part : part.replace(/<!--[\s\S]*?-->/g, '')))
    .join('');
}

/** タグを外し、<br> は改行に、&nbsp; と連続空白は詰める */
export function toText(fragment) {
  return fragment
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t\r　]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}
