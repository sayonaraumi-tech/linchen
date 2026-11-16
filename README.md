# 月輪合同会社 新業務システム — Desktop UI Preview

This is the **isolated UI prototype** for 9 agreed desktop pages. It is **not** a migrated production business system.

## Run locally

- Node.js 18+
- `npm test` to run syntax and static UI contract checks
- `npm start` and open http://127.0.0.1:8766/

## Screens

ホーム / 日程 / 見積履歴 / 帳票 / 保存帳票 / 売上・入金 / 支出・現金 / 銀行照合 / 設定.

- Left sidebar auto-collapses to ~56px and expands to ~190px on hover. Settings allow choosing auto/expanded/compact.
- Black `#171717`, champagne gold `#B99755`, gray background `#F5F5F3`.
- Tables, tabs, selected-row details, calendar, filters and input dialogs are wired for **demo interaction**.
- All monetary values and documents shown in lists are synthetic.
- PDF pane displays the **actual PDF selected from the local device** using the browser PDF viewer; download is the same selected file. The original four PDF generators, Logo, seals and Onoda pagination logic **have not been copied yet**.
- No Firebase configuration, credentials, Auth, production reads/writes, migration, cloud deploy or real accounting actions are present.
- The previous `main` and its historical commits are untouched.

## Architecture / next implementation gates

1. Import proven legacy PDF assets and renderers from `geruninn` without changing templates; test all four types, including Onoda pagination.
2. Introduce typed domain models/services/repositories; implement transaction idempotency, audit and read-only migration adapter.
3. Connect UI to isolated emulator and migrate a backed-up **test fixture**. Never point prototype code at production without explicit verification.
4. Run new/old parallel ledger tests and PDF image/text comparisons.
5. Launch in a browser and capture nine actual screenshots; user approval before merging or publishing.

**Do not treat this preview as migration acceptance or operational accounting software.**
