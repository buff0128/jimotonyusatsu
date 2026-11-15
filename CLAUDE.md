# じもと入札 — エージェント向けルール

全国の官公庁・自治体の入札案件を「1件＝1ページ」で公開するサイト。概要は README.md、計画は docs/PLAN.md。

## 絶対に守ること

- **git commit / push はしない。** 変更はユーザーがレビューしてコミットする
- **API で取れた値は書き換えない。** 官公需API・各取得元の値は `cases` にそのまま保存し、そのまま表示する。
  AI の抽出・要約は `case_ai` に分けて持ち、API の値が空の項目だけを埋める。表示では「公告から抽出（AI）」「AIによる要約」と明示する
- **茨城県 PPI（`source = 'ibaraki_ppi_koji' / 'ibaraki_ppi_buppin'`）は D1 に同期しない・表示しない。**
  運営者への利用確認が済むまでは手元の SQLite に置くだけ（docs/SOURCES_IBARAKI.md）
- **外部へのリクエストは常に1本ずつ。** 官公需APIは間隔1.5秒以上、PPI は2秒以上、公告PDFなどの取得も1.5秒以上あける。大量取得の前にユーザーに確認する
- 本番は https://jimotonyusatsu.jp（workers.dev は middleware で本番へ 301 転送）。公開までは全ページ noindex。外すときは `src/lib/site.ts` の `STAGING_NOINDEX` を false にするだけ
- 自分で取得した公告PDF・添付のテキスト（`data/docs/`）はサイトに載せない。表示するのは事実の項目、官公需APIの公告文（ProjectDescription）、公式へのリンク、AI の抽出・要約だけ
- AI 抽出は `data/ai/INSTRUCTIONS.md` の基準に従う（入札方法は3択。障害時だけ紙を認めるものは「電子のみ」。件名の補正は API の件名が明らかに壊れている場合だけ）
- お気に入りはログインなし・localStorage のみ。サーバーに個人の状態を持たせない
- ラベルは AI に判定させない。抽出値に `src/lib/labels.ts` のルールを当てはめる（docs/LABELS.md）
- 過去分（`cases_history`）は D1 に送らない。統計は手元で計算し、結果だけを送る。年間5件未満の統計は出さず、そのページは noindex
- 落札結果は調達案件番号で照合できたものだけを出す。件名での照合は手元の検証用で、表示には使わない（実在の会社名と金額なので誤りを1件も出さない）。出典「調達ポータル」と加工した旨を必ず表示する
- 検索エンジンのインデックス対象は、AI で公告を読んだ案件・ハブ・統計・解説記事だけ（`src/lib/indexing.ts`）。それ以外の案件ページは noindex。これは審査用ではなく正式なルール

## デザイン

- UI は docs/design/DESIGN.md と見本（docs/design/*.dc.html）に従う。色・文字・角丸・影は `src/styles/global.css` の CSS 変数だけを使い、値を直接書かない
- 藍は文字の色だけ（面に使わない）。柿 `--kaki` は図形だけで、文字は `--kaki-text`、ボタンは `--kaki-strong`。グラデーション・絵文字・左だけ太線のカードは使わない
- 「あと◯日」・締切が近いかどうかはブラウザで計算する（`src/scripts/countdown.ts`。ページはエッジキャッシュされる）
- 地元の選択は localStorage だけ（`src/scripts/local-area.ts`）。検索エンジン向けの HTML は地元の有無で変えない

## 環境

- Node 26（`.nvmrc`。`nvm use`）。pnpm を使う
- デプロイは `pnpm run deploy`（`pnpm deploy` は pnpm 自身のコマンドなので不可）。デプロイ前に `pnpm astro check`
- `worker-configuration.d.ts` は `pnpm install` の postinstall（`wrangler types`）で生成される。git には入れない
- D1 のスキーマ変更は `migrations/` に追加し、`pnpm db:migrate:remote`（と `db:migrate:local`）で当てる。手元 SQLite は scripts 実行時に自動で当たる
- 開発サーバーは `astro dev --background`（`astro dev stop` / `status` / `logs`）
- 公告文の全文は D1 の `case_descriptions` に分割して持つ（R2 は使わない方針）。D1 の `cases.description` は空。手元 SQLite の `cases.description` は全文（正本）

## D1 の読み取り・書き込み（無料枠：1日 読み取り500万行・書き込み10万行）

- ページで COUNT / GROUP BY をしない。件数は同期のときに `case_counts` / `org_stats` に計算しておき、それを読む
- 一覧のクエリはインデックスの順に読む（`ORDER BY c.cft_issue_date DESC`、source の条件は `+c.source`）。クエリを足したら `node scripts/explain-queries.mjs` に加えて全件走査が無いか確認する
- 同期は差分（`d1_sync_state` に前回送った内容を記録）。インデックスを増やすと既存の全行ぶん書き込みが発生するので慎重に
- 本番での確認は必要最低限のページだけにする

## データの流れ

取得スクリプト（scripts/fetch-*.mjs）→ `data/`（生データ・gitignore）→ `data/jimoto.sqlite`（正本）→ `pnpm sync:d1` → D1 → Astro（SSR）

## Astro のドキュメント

- https://docs.astro.build
- ルーティング: https://docs.astro.build/en/guides/routing/
- コンテンツコレクション: https://docs.astro.build/en/guides/content-collections/
