# ローカル隔離受入の再現

対象のベースは linchen PR #6 のコミット
`8d84db8a5746bddb94384a816d6fae81e853ea83`。
モック UI 用の従来エントリとは別に、Auth と Firestore のローカルエミュレーターに接続する受入エントリを追加した。

## 実行

Node 22 以降、Java 21、Playwright Chromium を用意する。

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run build:acceptance
npm run typecheck
npm test
npm run test:browser
LINCHEN_EVIDENCE_DIR=/absolute/path/to/evidence \
  npx firebase emulators:exec --only auth,firestore --project demo-tsukinowa-construction \
  'node --test tests/firestore-rules.test.cjs tests/acceptance-browser.cjs'
```

受入テストは使い捨ての検証ユーザーを Auth エミュレーターに登録し、別々の Chromium コンテキストでログインする。
日時や採番は実行時に決まり、試験用パスワードは一時生成する。
データを Firestore に実際に書き込み、CSV と PDF の原本・監査・採番を別の空の名前付き DB に復元する。
エビデンス用 PDF は請求先に送付できないよう検証表記を付け、振込先と登録番号を伏せる。

手動実行時もプロジェクトは `demo-` で始まる必要がある。サーバーは Auth と Firestore が両方ループバックのエミュレーターに接続する場合だけ起動する。
エミュレーターの UID に `companyId` と `role` のカスタムクレームを設定した上で、`GCLOUD_PROJECT` と `LINCHEN_COMPANY` を指定して `npm run serve:acceptance` を実行する。

## 実装範囲

- TypeScript の認証・API クライアントと Node サーバーが既存の Domain、Firestore トランザクション、凍結 PDF レンダラーを使用する。
- 権限判定と直接書込禁止はサーバーと Firestore Rules が担当する。画面はサーバーが返す版数を使う。
- CSV は識別番号または残高が付いた 1〜5 明細、6 KiB 以下を対象とする。元バイト、SHA-256、ファイル名、紐付く明細 ID を保存する。照合には別の確認操作が必要。
- 正式 PDF 保管は帳票の発行と独立した操作。確定済みスナップショットから生成し、表示額・明細・正式番号を検査してから、分割バイトと SHA-256 を監査付きの単一トランザクションに保存する。

## 運用上の未検証事項

クラウド HTTPS、招待と本番向け MFA、定期的な外部バックアップとアラート、実履歴の移行、運用上の電子取引保存適合性は別途実環境での検証が必要。
## クラウド受入

`Dockerfile.acceptance` は同じサーバーをコンテナで実行する。クラウドモードの対象は
`linchen-acceptance-20261116` のみで、エミュレーター変数が設定されていると起動を拒否する。
ホスティングの TLS 終端を使用し、コンテナには Firebase の公開 Web 設定、会社 ID、および
専用ランタイムの Google Application Default Credentials を別々に設定する。

`LINCHEN_CLOUD_ACCEPTANCE=1`、`GCLOUD_PROJECT`、`LINCHEN_COMPANY`、
`LINCHEN_FIREBASE_API_KEY` と `LINCHEN_FIREBASE_APP_ID` を設定する。
Firestore は `firebase.acceptance.json` のルールでクライアントからの直接アクセスを拒否する。
管理者の API アクセスには検証されたメールと TOTP で発行された Firebase トークンが必須。
招待時は許可済み UID に会社 ID と役割を付与し、本人が初回パスワード設定と認証アプリの登録を行う。

## バックアップと復旧

受入テナントのスナップショットを一貫した読み取りで取得し、AES-256-GCM で暗号化する。
アーカイブの PDF バイト列、銀行 CSV 原本、監査記録、正式番号を含む。
個別に管理する 32 バイトのバックアップ鍵を権限 0600 のファイルに保管する。
別途付与した読み取り専用 ADC と独立した書き込み先を用いる。

```sh
node scripts/tenant-backup.cjs export linchen-acceptance-20261116 TENANT /backup/dated-snapshot.enc
node scripts/tenant-backup.cjs restore linchen-acceptance-restore-example TENANT /backup/dated-snapshot.enc
```

復旧環境は新規の独立プロジェクトを指定する。本番および受入データへの上書きは行わない。
再実行は既存の同一レコードを照合し、競合時に中断する。
ローカル受入では暗号化ファイルの実復旧、鍵不一致の拒否および再実行を確認する。
クラウドの定期起動・別権限の保管先・アラートはホスティング設定時に検証する。
