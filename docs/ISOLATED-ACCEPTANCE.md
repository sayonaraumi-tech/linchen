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
このエントリは公開環境へのデプロイに使用できない。
