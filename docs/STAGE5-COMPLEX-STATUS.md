# 阶段 5：旧系统复杂功能与正式数据接口（2026-11-13）

源仓库基线：`sayonaraumi-tech/geruninn@6674e019731b7fbc490e52e32fed348f7c0b7a6d`。
新仓库：`sayonaraumi-tech/linchen`，分支 `develop/tsukinowa-construction`，PR #1 草稿。

## A. 已编写并有隔离自动化测试的模块

| 模块 | 实现文件 | 当前范围 |
| --- | --- | --- |
| 主要会计业务 | `src/core/business.js` | 设置、客户、案件、日程、正式帳票、売上、收款、现金镜像、支出、银行和材料供应商操作；所有命令克隆状态原子处理并记录操作审计 |
| 正式帳票编号 | `src/core/document-numbering.js` | Asia/Tokyo `YYYYMMDD-HHmm-NN` 共用编号；新发行/订正时分配，草稿/重复下载不分配 |
| 帳票订正和无效 | `src/core/business.js` | 原始快照保留、订正后共用 sale/payment 身份，禁止下调至已确认或待确认入金额以下 |
| 独立 PDF 读接口 | `src/pdf/frozen-document.js` | 固定保存快照、调用原文件名函数、重下载不产生业务写入；实际浏览器导出仍需最终集成 |
| 银行 CSV | `src/integrations/bank-csv.js`、`bank-import.js` | GMO 常用表头、Shift_JIS/UTF-8、银行摘要/余额/交易编号、别名、逐行错误、重复识别、仅导入证据、不擅自入账 |
| 仕入先 | `src/core/business.js` | 期首余额可正/负、预付款、现金转账、每仕入先每月一笔材料请款、余额、银行链接；月请款生成材料费一次 |
| Google 日程 | `src/integrations/calendar-sync.js` | 稳定 CalendarID+EventID、分页、取消标志、延迟更新保护、日期/位置字段、PATCH 冲突；未接入正式 OAuth/Google 实际账户 |
| 财务查询/CSV | `src/core/views.js` | HOME/月次/年度、売上/入金、支出/现金、未入金、保存帳票、CSV 注入防护；金额按日期字段归期 |
| 隔离测试存储 | `src/storage/sandbox.js` | 持久化、多次开启保留记录、仅测试命名空间逐条删除、冲突保护、备份，不清空全部测试记录 |
| 离线队列 | `src/storage/outbox.js` | 操作先本地保存后提交、失败保留、重试幂等、冲突封存、按账号隔离；尚需连至正式 Firestore 应用服务 |
| Firestore 网关 | `src/storage/firestore-repository.js`、`firebase-web-driver.mjs` | 身份公司作用域、管理员权限、乐观版本、不可重复操作、事务审计、正式编号事务预留；默认禁止正式写入 |
| Firestore 权限 | `firestore.rules`、`tests/firestore-rules.test.cjs` | 真实模拟器验证跨公司阻止、staff 权限、审计条件、正式编号保留、历史帳票快照不可覆盖 |
| 冻结 PDF | `legacy-pdf/source/`、`tests/legacy-pdf-real.cjs` | 原版 17 文件字节比对、四种帳票 14 组真实渲染/像素一致；无 UI 改动 |

## B. 用户指定的测试数据处理

- 对测试记录新增明确的单条 `deleteTestRecord`，要求 `scope=test`、显式确认、不得遗留活跃关联记录。
- 测试沙盒持久保留已录入的数据，不会因页面重新打开自动重置，不把每次测试设为清空数据。
- 正式业务的原始帐票、收款、银行匹配等不得直接物理删除，只能通过专门的取消/订正操作及审计。
- CI 单元测试与 Firestore Emulator 使用合成数据和独立环境，不连接或清空生产 Firebase。

## C. 当前测试基线

- `Independent business core`：59/59 Node 测试通过，运行 ID `43382874883`。
- `Isolated Firestore security`：真实 Firebase Emulator 安全测试通过，运行 ID `43382082679`。
- `Original PDF parity`：14/14 真实 PDF 对照通过，运行 ID `43378719925`。此结果来自原版 HTML/JS 完整冻结副本，**不能替代新业务接口到 PDF 的最终集成测试**。

## D. 仍未补齐、不得误称为完整生产系统

1. 新业务核心目前是独立纯业务引擎；尚未完整替代原业务域所有特殊流程和历史兼容路径，特别是 Stripe / NP / ATO 平台净额及手续费、同日多笔/多对一的银行复核、信用卡月度合并扣款、支出 CSV 科目学习与复杂税务处理。
2. Firestore 网关是可用的隔离事务接口，但**尚未把所有高阶业务命令以多记录原子事务完整接入**，正式写入默认关闭。不能将测试权限规则直接用于生产发布。
3. Google Calendar 双向同步接口已建，但真实 OAuth 授权/同步/409-412 修复和离线回写没有进行生产账号验证。
4. 原始 PDF 渲染源码对照通过，但新帳票业务对象到原版渲染器的真实正式输出、历史下载零写入，需要完整运行系统复测。
5. 全部原数据字段、历史结构、帳票格式、编号和 CSV 导入模式仍需建立最后的逐项映射与全链路回归矩阵。
6. UI 阶段 6 尚未实施。按用户要求，先提交 UI 方案并由用户确认，再进行阶段 7 正式历史数据迁移、阶段 8 正式切换。无未经批准的合并或上线。

## E. 交付边界

原仓库 `geruninn` 未修改；新仓库 PR #1 保持 Draft 未合并。测试仅为合成数据。公开的 `linchen` 仓库禁止提交客户资料、银行明细原件、Firebase 密钥以及任何生产数据。
