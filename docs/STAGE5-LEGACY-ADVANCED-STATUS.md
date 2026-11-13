# 阶段 5：历史兼容和高级操作继续验收（2026-11-13）

本报告根据原仓库 `sayonaraumi-tech/geruninn@6674e019731b7fbc490e52e32fed348f7c0b7a6d` 的实际源码及原始测试用例，与独立仓库 `linchen/develop/tsukinowa-construction` 对照。**不接入生产 Firebase，不合并 PR，不进行第 6 阶段 UI 开发。**

## 1. 本次已经补齐并有自动测试的部分

| 工作流 | 代码 / 测试 | 业务保证 |
|---|---|---|
| 旧 15 集合兼容影子层 | `src/compat/legacy-shadow.js` | 保留原始 ID、原字段、旧正式 snapshot 和 Google/estimate 关联；只读，不自动搬入新账本 |
| 旧 `receivable_` 入金主体 | `src/compat/legacy-contract.js` / `legacy-ledger-parity.cjs` | 原 payments.saleId 可能属于旧 receivables 而不是 sales；不可另造売上 |
| 旧账余额等价验证 | `tests/legacy-ledger-parity.test.cjs`, `legacy-shadow.test.cjs` | 用冻结旧 `accounting.js` 逐记录比较截至指定日期的已入金、未收金额；旧 `receivableOnly` 不作为新売上 |
| 見積受注→独立日程 | `acceptEstimate` + `estimate-acceptance.test.cjs` | 允许未定日期；确定日期建立一次 project/schedule；转换請求后只使用一次 sale；无需 Google |
| 未入金提醒 | `src/compat/outstanding-adapter.js` | 复用旧 `outstanding.js`，只读计算和文案，不新建销售、未收、帳票番号 |
| 仕入先月請求及预付款 | `settleSupplierInvoice` + `supplier-reviewed.test.cjs` | 官方請求需人工确认；材料費全额一次入账，抵扣额只减少前渡金；保留应付款差额，不重复支出 |
| 支出科目学习 | `saveExpenseCategoryRule` | 只对以后新费用建议分类，历史科目不改动；规则可停用 |
| 银行排除 | `bankExclude` | 必须理由，禁止对已照合的明细直接排除；先解除照合 |
| 现金余额调整 | `cashAdjustment` | 明确确认、唯一 ID、审计；不是売上、不是支出费用 |
| 历史 PDF 导入预检 | `src/compat/historical-pdf-preview.js` | 复用冻结旧原版校验，查重复 invoiceNo/hash/金额等，返回歧义，禁止自行生成売上 |
| 旧命令差异 | `docs/LEGACY-COMMAND-GAP-MATRIX.md` | 从旧实际源码扫描 41 类命令；新 core 当前 27 类，命令名称不能简单对号入座 |

## 2. 最新核心安全原则

1. **平台手续费**：NP 月自动扣款与 Stripe/ATO 月汇款，只读内部核对。不能通过这些资料创造销售或重复登记银行流水。
2. **银行金额**：导入是银行证据，真正入金/payment 是独立对象，不能凭金额、日期及客户名称相似就自动合并。
3. **旧未收**：`receivable_` 可作为老付款关联主体，即使它不属于当期新 `sales`，也不能丢弃其现金/银行收款历史。
4. **原件**：旧正式 snapshot/编号保持不变。旧 `estimates` 与 `calendarLinks` 保留原始记录，任何迁移都不覆盖原件。
5. **未知字段**：旧原件字段/状态不认识时必须明确拦截或归档，绝不静默丢弃。
6. **测试数据**：本机临时工作台用隔离存储；生产 `geruninn`、正式 Firebase 和正式 PDF 均未修改。

## 3. 仍未达到的最终验收（UI 不能提前开始）

| 阻断级别 | 未完成事项 | 当前后果 |
|---|---|---|
| 高 | **真实旧数据完整字段/金额/时间/状态** 未以有权限且脱敏的 15 集合导出运行旧→新对照 | 当前合成用例通过，不等于真实历史记录全等；不能宣称无损迁移 |
| 高 | 旧 `estimates`、`receivables`、`calendarLinks` 的**完整写入生命周期**与旧云端多设备关联尚未一比一实现 | 已能只读审计和新規受注，但老数据复杂操作/迁移仍会被拦截 |
| 高 | 独立新系统完整登录、安全服务器端业务约束、Firestore 云端持久化与真实历史 PDF 重下载 | 仍只有隔离原子事务模拟与本机工作台，不能承诺生产安全 |
| 高 | 旧银行/费用/供应商的高级场景如强身份证据唯一自动照合、专用撤销/恢复、跨卡或供应商并发调整等逐项行为回归 | 已有基本人工照合和月度供应商控制，但不是全部老流程 |
| 中 | 真实 Google OAuth/专用测试日历的双向写入、失败恢复和并发处理 | 适配器测试通过，不代表真实账号验证 |
| 中 | 原版 PDF 偶发像素差异根因尚未独立隔离 | 已通过的 PDF 像素测试仍需持续稳定性验收 |
| 中 | 完整备份/恢复、安全性能及大数据量查询 | Full-collection Firestore load 仍需分页/按 ID 优化 |

**本阶段的完成定义**：旧系统业务规则逐项获得功能同等的安全实现或经用户明确批准淘汰，旧与新针对同一批脱敏数据的金额及业务关联一致，云端并发/权限/恢复与真实 PDF 通过，关键 CI 全绿。否则必须保留 Stage 5 未完成状态。

## 4. 当前可复现的验证

- `npm test`：独立核心业务、旧 read-only 桥、确认入金、未收、供应商、分类学习、银行排除、现金调整、旧 PDF 预检等合成回归。
- `npm run test:browser`：本机 8 区块工作台实际按钮流程。
- `npm run test:rules`：模拟 Firestore 的规则与原子事务测试，不能替代正式云端验证。
- `npm run audit:legacy -- /absolute/path/to/anonymized-legacy-collections.json`：**本地只读**，输出数量和金额差额及阻断项，不输出客户敏感明细、不上传；无论结果如何都不授权迁移。

## 5. 发布控制

`linchen` PR #1 保持 **Draft**。禁止自动 merge、修改旧仓库、连接正式 Firebase、清空或更改用户历史数据、导入真实资料，以及进入第 6 阶段 UI 代码实施。

## 6. 同日追加：高级银行收入、供应商取消和模拟器事务复测

- `reviewBankIncome`：GMO 银行入金仅在人工审核后归类为 `受取利息` / `雑収入`，不产生工事売上和第二笔入金。解除照合时取消该收入分类；HOME/期间报表列出 `otherIncome`，并按实际银行日期归属。
- `voidSupplierTransaction`：明示理由取消供应商交易；已与银行照合的先解除照合；若是月度請求则相关材料費同时无效，若是现金预付则撤销唯一现金镜像；原交易及审计仍保留。
- 原本 `recordSupplierTransaction` 不得复用已取消的交易 ID，防止取消后静默再创建。
- Firestore Emulator 测试已加入 `acceptEstimate` 和 `settleSupplierInvoice` 的完整原子事务及重试用例。
- 最近结果：核心业务 **142/142** 通过（https://github.com/sayonaraumi-tech/linchen/actions/runs/43416178562）；Firestore Emulator **9/9** 通过（https://github.com/sayonaraumi-tech/linchen/actions/runs/43416172444）。
- **仍不满足正式上线或第6阶段 UI 准入**：全量历史实物、旧所有高风险命令、云端安全业务校验/恢复及 PDF 非确定性仍有缺口。
