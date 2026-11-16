# 旧系统字段、ID 和业务关系最终核对 — 安全审计

基准：`geruninn@6674e019731b7fbc490e52e32fed348f7c0b7a6d`。新仓库 `linchen` 的 `develop/tsukinowa-construction` 分支。

## 结论

**已检查原代码的 17 个入口文件和全部 15 种云集合；但仍有不兼容模型。当前完成的是“差异和阻断项核对”，并非宣称真实旧数据已可无损迁移。**

旧系统正式客户数据没有导入；仅合成测试和只读契约检查。任何未知字段/无标识记录/已确认旧帳票缺 snapshot 都必须明确阻断，禁止靠自动补默认值或直接覆盖解决。

## 旧集合与新领域映射

| 旧集合 | 新对应 | 当前状态 | 不能省略的关键关系 |
| --- | --- | --- | --- |
| `calendarLinks` | `schedule` | 显式映射待完成 | CalendarId / GoogleEventId、saleId、linkedInvoiceId、linkedReceiptId、已记账状态 |
| `estimates` | **尚缺独立估价聚合** | **阻断迁移** | estimateId、见积受注日期、projectId、工事予定 |
| `projects` | `projects` | 字段兼容待核 | 受注、estimateId、施工日期/时间/地点 |
| `documents` | `documents` | 快照保护已实现、旧 schema 待核 | 旧 documentId/confirmed/invoiceNo、原版 snapshot、订正及重复关系 |
| `sales` | `sales` | 核心逻辑已实现、旧字段待核 | sourceId、saleId、estimateId、documentId、date、status |
| `receivables` | **尚缺独立旧应收记录模型** | **阻断迁移** | receivableId、saleId、未入金、部分入金及旧来源 |
| `payments` | `payments` | 需要原字段兼容 | paymentId、原 invoice 关联、现金/银行确认、bankTxnId |
| `expenses` | `expenses` | 需要字段兼容 | category、bankAccount、原票据、deletedAt、原支払方法 |
| `suppliers` | `suppliers` | 需要字段兼容 | supplierId、openingBalance、负数应付、日付 |
| `cashLedger` | `cashLedger` | 需要字段兼容 | linkedPaymentId、linkedExpenseId、供应商现金付 |
| `auditLogs` | 历史审计归档 | 保留原本 | 不重置创建者、时间、操作 ID |
| `settings` | `settings` | 需要原字段映射 | 公司登録番号、銀行口座、分类学习、帳票设置 |
| `bankTransactions` | `bankTransactions` | 需要字段兼容 | 原 CSV 摘要、occurrence、旧匹配、排除或取消状态 |
| `supplierTransactions` | `supplierTransactions` | 需要字段兼容 | 月请款、预付款、调整、bankTxnId |
| `migrations` | 历史归档 | 不自动重跑 | 旧迁移标记保留 |

### 旧本地存储

保留原键 `tsukinowa_business_v1`、`tsukinowa_chohyo_confirmed_history_v1`、`tsukinowa_business_settings_v1`。新独立测试程序只用 `linchen_independent_test_v1`，**不读取或改写这三个旧键**。

### 业务不变量

1. 見積書不能当売上；見積→受注→請求→入金的 source / project / estimate 关联必须可追溯。
2. 已有 sale / payment 的现金領収書必须复用原记录，不能再次生成売上或现金账；正常历史 PDF 重下载零财务写入。
3. 银行 CSV 仅作照合证据；平台 NP/Stripe/ATO 月次手续费核对仅读，不自动追加売上。
4. 小野田前月繰越为打印展示金额，不属于当月新売上。
5. 改正前旧帳票不可换号、抹去原 snapshot，旧的 `confirmed`、缺 status 状态不能强行设成新 status。
6. 多源 ID、日历/Google 事件 ID、银行 externalId 必须保持唯一身份；不能凭客户名/金额/日期相同自动合并。

## 核对工具

- `src/compat/legacy-contract.js`：只读字段契约、15 集合映射、未知集合阻断、正式 snapshot/编号/重复 ID 检查。
- `tests/legacy-contract.test.cjs`：合成数据回归验证，旧正式编号不变、未知/缺失字段阻断、估价和应收数据不悄悄消失。
- `docs/LEGACY-CODE-ENTRYPOINTS.md`：从实际旧源码扫描 17 文件、335 个具名函数声明、41 类 `cmd.type` 命令。
- 本地只读审计指令：`npm run audit:legacy -- /绝对路径/脱敏旧数据.json`。仅在用户本机执行，不自动上传、修改或持久化。输出汇总与阻断数，不打印客户内容。

**迁移必须保持禁止状态**，直到两个尚缺的旧集合有完整新结构，旧数据每类字段逐项比对通过，并完成金额/帳票/未入金全链路并行核验。该阶段只开发隔离系统，不执行第 7 阶段正式数据迁移。

## 新应用实际可运行基础

运行：`npm install` 后 `npm run dev`；在开发机打开 `http://127.0.0.1:4173/app/index.html`。

这是**临时业务工作台**，仅允许本机保存合成测试数据，无 Firebase 服务授权、无正式 Google Calendar 接入、无正式财务数据库访问。包含 HOME / 日程 / 帳票 / 帳票履歴 / 売上・入金 / 支出・現金 / 銀行照合 / 設定八个入口。独立的内部日历无需 Google；帐票 PDF 正式渲染通过独立 CI 进行，不在临时工作台伪造模板。

回归：`npm test`（纯单元）、`npm run test:browser`（先安装 Playwright 浏览器）、`npm run test:rules`（独立 Firebase emulator）。CI 失败不得合并。UI 正式设计仍留在第六阶段。

## 剩余兼容和生产阻断

- **高**：旧 `estimates`、`receivables` 与 `calendarLinks` 数据关系尚无完整新应用模型。
- **高**：新端与 Firestore 正式登录、跨会话保存、已存原版 PDF 重下载尚未在受控应用内完成。
- **高**：业务不变量仍主要在客户端，需更强服务端权限/业务完整性验证。
- **中**：全量数据加载及多账户冲突会随业务增长而增加成本，需针对实体的按 ID 查询。
- **中**：旧数据真实样本未核验；没有拿到有权限、脱敏的历史导出，因此不能断言字段完全一致。
- **中**：Google 真实 OAuth 与専用测试日历双向写入未执行（内部日历无需它）。

截至本文，本次开发仅用于阶段 5 验证，严禁生产切换、合并上线、真实数据写入和未授权数据改写。
