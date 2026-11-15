# じもと入札（jimotonyusatsu）実装計画

## プロダクト概要

全国の官公庁・自治体の入札案件を、**案件1件＝1ページ**で、登録なし・完全無料で公開する入札情報サイト。
収益は広告（AdSense）と、入札参加資格の取得代行などのアフィリエイト。新着通知メールの登録口も最初から置く。

- 想定ユーザー：地元の中小企業（建設・印刷・清掃・警備・IT/Web制作など）の経営者や営業担当
- 集客：案件名・市町村・業種のロングテール検索（公式PDFしか上位にいないキーワードが多い）
- 差別化：既存サービス（NJSS / nSearch / Labid など）は有料会員向けにデータを囲い込んでいる。こちらは全部公開して広告で回す

## 決定事項

| 項目 | 内容 |
|---|---|
| サービス名 | じもと入札 |
| リポジトリ | https://github.com/buff0128/jimotonyusatsu |
| ローカル | `/Volumes/Develop/jimotonyusatsu`（手元のMac） |
| ドメイン | 未定（`jimotonyusatsu.jp` が第一候補。取得まではworkers.devで動かす） |
| フロント／配信 | Astro（SSR）＋ Cloudflare Workers ＋ D1 |
| D1 | `jimotonyusatsu`（APAC）／ database_id: `cf302650-4c73-4191-a53d-ada4b8fb5308`／バインディング名は `DB` |
| Cloudflareアカウント | ishikawa.onore@gmail.com のアカウント（エンライト用とは別）／Account ID: `89cef33d9940786a848d14ed49fdc8d5` |
| ステージングURL | `https://jimotonyusatsu.ishikawa-onore.workers.dev`（Worker名 `jimotonyusatsu`） |
| データ取得の実行場所 | 当面は手元のMac（定時実行を始める段階でmac-serverに移す） |
| 要約 | 当面はClaude Code自身が書く（APIは使わない）。定時実行に移る段階でAPIかローカルLLMかを決める |
| 最初の対象地域 | 茨城県（LG_Code=08） |

## データソース

### 官公需情報ポータルサイト 検索API（入札）

- URL: `http://www.kkj.go.jp/api/`（GET/POST、XMLで返る）
- 主なパラメータ：`Query` / `Project_Name` / `Organization_Name` / `LG_Code`（いずれか1つ必須）、`Category`（1物品・2工事・3役務）、`Procedure_Type`、`CFT_Issue_Date`（`YYYY-MM-DD/YYYY-MM-DD`）、`Count`（最大1000）
- 取れる主な項目：Key、ProjectName、Date、LgCode、PrefectureName、CityCode、CityName、OrganizationName、Certification、CftIssueDate、PeriodEndTime、Category、ProcedureType、Location、TenderSubmissionDeadline、OpeningTendersEvent、ItemCode、ProjectDescription（公告文）、ExternalDocumentURI、Attachments
- 掲載は発注機関の公開から1日程度遅れ、全件は保証されない

**利用規約で守ること**
- APIを使っている旨を明記し、ポータル（https://www.kkj.go.jp/s/）へリンクする
- 同時リクエスト数を絞り、特定のサーバーから大量アクセスし続けない（日付×都道府県で差分取得、リクエスト間に待ちを入れる）
- 利用者とのトラブルは自己責任（自サイトの規約に免責を書く）

### jGrants API（補助金）：今回はやらない

- 将来用。出典表記「出典：Jグランツ」＋加工の明記が必須。APIで取れる事実項目（金額・締切など）はLLMで書き換えない（規約で「事実に反する内容」が禁止）

## 全体構成

```
[手元Mac → 将来mac-server]
  官公需API → SQLite（正本） → 公告PDFの本文抽出 → 抽出・要約 → D1へ同期
                                                          ↓
[Cloudflare] Workers + D1 + Astro（SSR + エッジキャッシュ）で全ページ配信
```

- 静的生成にしない理由：全国で数十万ページになりうるので、デプロイ単位のファイル数上限を避け、D1から読んでSSR＋キャッシュで返す

## データ設計（案）

- `cases`：key、件名、発注機関、都道府県コード、市区町村コード、カテゴリ、公示種別、資格等級、公告日、入札日、開札日、納入期限、履行場所、公告文、公告URL、添付（JSON）、取得日時
- `case_ai`：case_id、必要な資格、入札方法（紙／電子）、要約、生成者（モデル名）、生成日時
- `orgs`：発注機関名、slug、都道府県
- `areas`：都道府県・市区町村コード、slug（ローマ字）

**原則**：日付・機関名・等級などAPIで取れる値は、LLMに書き換えさせず、そのまま表示する。LLMは「必要な資格」「入札方法」「業務概要の要約」だけを担当する。

## ページ構成

| ページ | URL例 | 中身 |
|---|---|---|
| 案件詳細 | `/cases/{id}` | 概要・日程・資格・入札方法・要約・公式PDFリンク・関連案件 |
| 都道府県ハブ | `/ibaraki` | 新着、カテゴリ別、市区町村一覧 |
| 県×カテゴリ | `/ibaraki/ekimu` | 役務の案件一覧（buppin / koji / ekimu） |
| 市区町村ハブ | `/ibaraki/mito` | 市区町村内の案件 |
| 発注機関 | `/orgs/{slug}` | その機関の案件一覧 |
| 解説記事 | `/guide/...` | 入札の始め方、資格の取り方（MDX） |
| 固定ページ | — | 運営者情報、プライバシーポリシー、お問い合わせ、免責・出典 |

- パンくず：入札情報 > 役務 > 茨城県 > 水戸市 > 案件（BreadcrumbListの構造化データも出す）
- `sitemap.xml`（分割）と`robots.txt`
- 全ページのフッター：官公需情報ポータルサイトAPI利用の明記とリンク、AI要約である旨と「正式な情報は公告を確認」の注記
- 広告枠は場所だけ確保（右サイド2枠、下部追従1枠）。ポップアップは出さない

## フェーズ

### フェーズ1：データ取得
1. 茨城県・過去2週間分を `LG_Code=08 × CFT_Issue_Date（1日単位）` で取得し、生XMLを保存して正規化しSQLiteへ
2. 公告PDF・添付を取得して `pdftotext` でテキスト化（画像のみのPDFはスキップし件数を記録）
3. カバレッジ確認：1週間分について、API件数とPPI・県サイトの掲載件数を比べ、漏れ方をメモする

### フェーズ2：抽出・要約
- 公告文＋PDF本文から、必要な資格・入札方法・業務概要をJSONで抽出し `case_ai` へ
- 最初の100件はClaude Codeが書く

### フェーズ3：サイト
- 上のページ構成を実装し、workers.devへデプロイ

### フェーズ4：最初の100件公開（ドメイン取得後）
1. 茨城県で締切がまだ先の案件を、業種が偏らないよう100件選び、全件に要約を付ける
2. 解説記事3〜5本、ハブページ数個
3. 独自ドメイン設定、Search Console登録、サイトマップ送信
4. AdSense申請（センシティブカテゴリはブロック）
5. 通ったら1日の追加ページ数を少しずつ増やし、インデックス率を見ながら拡大

## 今夜のタスク

ゴール：**朝の時点で、茨城の案件がworkers.devの仮URLで見られる状態**

- **タスクA**：Astro＋Cloudflareアダプター＋D1（バインディング `DB`）の雛形、スキーマとマイグレーション、workers.devへのデプロイ
- **タスクB**：官公需APIの取得スクリプトとSQLite取り込み（茨城県・過去2週間）、D1への同期
- **タスクC**：案件詳細ページと茨城県ハブページを、要約なしで表示できるところまで

**注意**
- gitコミットは指示があるまでしない
- `create astro` は空ディレクトリ前提（現状は空）
- 途中で判断が必要になったら、止まらずに妥当な方を選んで、朝に判断の一覧を残す
