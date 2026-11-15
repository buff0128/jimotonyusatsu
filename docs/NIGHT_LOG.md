# NIGHT_LOG（2026-11-04 夜 → 11-05 朝）

対象：docs/PLAN.md「今夜のタスク」A〜C
結果：**茨城県の案件114件が https://jimotonyusatsu.ishikawa-onore.workers.dev で見られます。**

- 県ハブ：https://jimotonyusatsu.ishikawa-onore.workers.dev/ibaraki
- 案件詳細の例：https://jimotonyusatsu.ishikawa-onore.workers.dev/cases/efeea58e806942d7

---

## できたこと

### タスクA：雛形・スキーマ・デプロイ
- Astro 7.4（SSR）＋ `@astrojs/cloudflare` 14.4 の雛形を一時ディレクトリで作り、プロジェクトへ移した（既存の `.wrangler/` と `docs/` はそのまま）
- `wrangler.jsonc`：Worker名 `jimotonyusatsu`、D1 バインディング `DB`、`workers_dev: true`、observability 有効
- マイグレーション
  - `migrations/0001_init.sql`：`cases` / `case_ai` / `areas`
  - `migrations/0002_seed_ibaraki_areas.sql`：茨城県＋44市町村（スラッグはローマ字）
- ローカル D1 とリモート D1 の両方に適用済み
- workers.dev へデプロイ済み（Version ID `cc4e6bc1-c576-4477-a990-0c93aebd71fe`）
- `pnpm astro check`：エラー 0

### タスクB：取得・SQLite・D1同期
- `scripts/fetch-kkj.mjs`：`LG_Code × CFT_Issue_Date（1日単位）` で取得。リクエストは逐次で1本ずつ、間隔1.5秒、失敗時は最大3回まで待ち時間を延ばして再試行。生XMLは `data/raw/kkj/08/YYYY-MM-DD.xml` に保存し、`data/jimoto.sqlite` に upsert。日ごとの結果は `fetch_runs` テーブルに記録
- 取得範囲：2026-10-22〜11-04（今日を含む14日）、計14リクエスト → **114件**（全日成功）
  - 0件の日：10/24・25・31、11/1（土日）、11/3（祝日）、11/4（当日。ポータルの掲載は1日ほど遅れるため）
  - 1日のヒット数が1000件（上限）を超えた日はなし
- 同じ日を取り直しても件数が増えない（upsert で重複しない）ことを確認
- `scripts/sync-d1.mjs`：SQLite → SQL ファイル（`data/d1-sync.sql`）→ `wrangler d1 execute --remote --file`。リモート D1 は cases 114件、areas 45件

### タスクC：表示
- `/`：トップ（県ごとの新着10件）
- `/ibaraki`：県ハブ（種別ごとの件数、市町村一覧と件数、新着一覧を50件ずつページ送り）
- `/ibaraki/{koji|buppin|ekimu}`：県×種別
- `/ibaraki/{市町村スラッグ}`：市町村（例 `/ibaraki/tsukuba`）
- `/cases/{id}`：案件詳細（概要・日程の表、公告PDFと添付へのリンク、公告文、関連案件、出典）
- `/about`：出典・免責（運営者情報は「準備中」）
- パンくず＋ BreadcrumbList の JSON-LD、存在しないURLは 404 を返す
- 全ページのフッターに、官公需情報ポータルサイトAPIを利用している旨とリンク、正式な情報は公告で確認するよう促す注記
- **noindex**：全ページに `<meta name="robots" content="noindex, nofollow">`、Worker の全レスポンスに `X-Robots-Tag: noindex, nofollow`、静的ファイルにも `public/_headers` で同じヘッダー
- 本番で確認したこと：114件すべての詳細ページ・案件のある市町村ページ・種別ページが 200、存在しないURLは 404

### その他
- `git init` と `git remote add origin https://github.com/buff0128/jimotonyusatsu.git`（コミット・pushはしていない。`git ls-remote` の結果は空で、リモートはまだ空のようです）
- README.md を Astro の雛形からこのプロジェクト用の手順に書き換えた

## できなかったこと／やっていないこと

- 要約（`case_ai`）：指示どおりやっていない。テーブルと同期処理は用意済みで、中身は0件。詳細ページに要約欄はまだない
- 公告PDF・添付の取得とテキスト化：就寝前の合意どおりスキップ（`pdftotext` は未インストール）
- 発注機関ページ `/orgs/{slug}` と `orgs` テーブル：日本語の機関名からスラッグを作るルールが決まっていないので見送った
- `sitemap.xml`：noindex のステージングでは意味がないので見送った
- 広告枠の場所取り、解説記事（`/guide`）、プライバシーポリシー・お問い合わせ：未着手
- エッジキャッシュ：未実装。今は毎回 D1 を読む（応答は0.5〜1.5秒程度）
- カバレッジ確認（API件数と PPI・県サイトの比較）：フェーズ1の3番で、今夜の範囲外

## 判断ログ

1. **Node.js は Homebrew の v26（/opt/homebrew/bin/node）を使用**：create astro の雛形（Astro 7.4）は `engines.node >=22.23.4` を要求するが、nvm の既定 22.21.1 では足りない。Homebrew に 26.12.1 があったのでそちらを使った。コマンドは `PATH=/opt/homebrew/bin:$PATH` を付けて実行した
2. **pnpm のビルドスクリプト許可**：pnpm 10 は esbuild・workerd の postinstall を既定で止めるので、`package.json` の `pnpm.onlyBuiltDependencies` に esbuild / workerd / sharp を入れた
3. **案件ID**：API の `Key` は `ibaraki/tsukuba_ac/2026/20261102_01199` のようなパスを base64 にしたもの。URL にそのまま使うと `+ / =` が入りうるので、`sha256(Key)` の先頭16桁（16進数）を `cases.id` にした。Key から計算するので、SQLite を作り直しても同じIDになる
4. **市区町村コード**：API の `CityCode` は6桁（JISコード5桁＋チェックデジット）。areas と結合するため、先頭5桁を `cases.city_code` に入れた
5. **カテゴリ**：API は日本語（物品／工事／役務）で返す。`category` にはスラッグ（buppin/koji/ekimu）、`category_raw` には元の文字列を入れた。空のものは「未分類」と表示
6. **スキーマは1か所にまとめる**：手元 SQLite にも `migrations/*.sql` をそのまま流す（`scripts/lib/local-db.mjs`）。取得記録用の `fetch_runs` だけは手元の SQLite にしか置かない
7. **SQLite は `node:sqlite`（Node 標準）を使用**：better-sqlite3 のようなネイティブ依存を増やさないため
8. **XML パーサに `fast-xml-parser` を追加（devDependency）**：取得スクリプトでしか使わないため。コード類（"08" など）が数値にならないよう `parseTagValue: false` にした
9. **D1 同期は `INSERT OR REPLACE` の SQL ファイル**：今は114件で約1.4MB。D1 は1ステートメント100KBまでなので、90KBを超える行だけ公告文を末尾で切る処理を入れた（今回切った行は0件。正本の SQLite は切らない）
10. **Astro のセッション機能を無効化（`session: false`）**：既定のままだと、使わない SESSION 用の KV namespace がデプロイ時に自動で作られるため。`imageService: 'passthrough'` にして IMAGES バインディングも作らせない
11. **`@cloudflare/workers-types` を削除**：`wrangler types` が生成する `worker-configuration.d.ts` にランタイムの型も入っていて、両方あると型が重なるため
12. **`@astrojs/check` と `typescript@6` を devDependency に追加**：`astro check` は TypeScript 7 に対応していないので 6 に固定した
13. **robots.txt は全許可**：Disallow にするとクローラーが noindex を読めず、URL だけがインデックスされることがあるため。検索結果から外すのは noindex（meta とヘッダー）の役目にした
14. **`/ibaraki/{slug}` は種別と市町村で共用**：PLAN の URL 例どおり。種別のスラッグ（buppin/koji/ekimu）と市町村のスラッグは重ならないことを確認済み
15. **値がない項目は「公告をご確認ください」と表示**：API で取れない値を推測で埋めない（PLAN の原則に合わせた）
16. **外部リンクに `rel="noopener nofollow"`**：公告PDF・添付は外部の自治体サイトなので
17. **`pnpm deploy` ではなく `pnpm run deploy`**：`deploy` は pnpm 自身のコマンドと名前がぶつかる。スクリプト名はそのままにして、README に注意を書いた

## 私が確認・判断すべきこと

1. **表示の確認**：/ibaraki と案件詳細を数件見て、見た目と項目の並びがよいか
2. **カテゴリが空の案件が多い**：114件中73件（64%）は API の Category が空。種別ページ（例 `/ibaraki/koji`）に出てくるのは残りの41件だけ。件名・公告文から種別を推定する（ルールで判定するか、要約と一緒にLLMで付けるか）を決めてほしい
3. **件名がPDFのファイル名になっている案件がある**：114件中10件（例「1793338683_doc_203_0.pdf」、かすみがうら市など）。API がそう返している。PDF本文から件名を取り直すか、一覧から外すか
4. **日程がほとんど取れていない**：入札日（`TenderSubmissionDeadline`）があるのは5件だけで、開札日・納入期限・資格等級・履行場所は0件。「締切がまだ先の案件を100件選ぶ」（フェーズ4）には、公告文・PDFから日付を抜き出す処理が必要になりそう
5. **Node のバージョン**：Astro 7 は Node 22.23.4 以上が必要。nvm で 22 の新しい版か 26 を入れて `.nvmrc` を置くか、Homebrew の Node を使い続けるか（`.nvmrc` は置いていない）
6. **雛形に入っていた `AGENTS.md`**（Astro 向けのエージェント用メモ）と `.vscode/`：残すか消すか
7. **git**：すべて未追跡のまま。`data/`・`.wrangler/`・`.dev.vars*` は .gitignore に入れてある。`worker-configuration.d.ts`（`wrangler types` で生成、約1.4万行）をコミットするかどうか
8. **運営者情報**：/about は「準備中」のまま。AdSense 申請の前に必要
9. **案件IDの形式**：16桁の16進数（例 `/cases/efeea58e806942d7`）。公開後は変えにくいので、この形でよいか

## 朝に動かすとき

```sh
export PATH=/opt/homebrew/bin:$PATH   # Node 26
pnpm fetch:kkj        # 茨城・過去14日を取り直す（差分は upsert）
pnpm sync:d1          # リモート D1 へ
pnpm run deploy       # コードを変えたとき
```
