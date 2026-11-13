# 阶段 5 补充验收：平台依据、独立日程、Firestore、多类型帳票 PDF

日期：2026-11-13。原系统基线 `geruninn@6674e019731b7fbc490e52e32fed348f7c0b7a6d`，仅在 `linchen/develop/tsukinowa-construction` 开发，不连接正式 Firebase、Google 或客户账簿。

## 1. Stripe / NP / ATO 的费用核对依据

**官方平台交易和精算明细是金额计算的首要证据；银行/实际到账账户流水是结算到账证据；原始订单和旧系统売上是业务关联证据。**

- 官方平台逐笔结算数据提供 **gross / refund / fee / adjustment / net**，不能从银行净到账金额倒推费率。
- Stripe 提供 transaction、balance transaction、payout 批次之间的关联；NP／ATO 按实际运营平台出具的請求書与精算说明确认类别，不能预设 NP 和 ATO 是完全独立的收款公司。
- 银行收到的款项以 statement/batch ID 关联结算，允许 9 月销售、10 月入金；到账日期不改变销售发生日。
- 人工审核平台订单号与正式売上 source ID，确认不是平台订单重复计入売上；手续费一笔独立计费一次；平台入金不是第二次売上。
- 公式：`gross - refund - fee + adjustment = officialNet`，再验证官方净额等于银行对应批次实际到账（如汇总转入个人账号亦标记实际到账账号，不自动归入法人现金）。
- `src/integrations/platform-settlement.js` 使用**用户提供的官方结算逐笔行**和明确的订单、银行证据，返回 reconciled/review 及差额。禁止写入固定推测费率。**这只验证核对算法，并不代表以前真实 Stripe / NP / ATO 数据已经结清。**

**法人信用卡不常用：** 保留单笔支出和已存在扣款的安全核对；复杂月度多对一结算降为低优先级，未自称完成。

## 2. 自有施工日历优先，Google 完全可选

- `src/core/schedule-calendar.js` 生成每月日历网格与内部联系记录，显示人工建立日程、日程关联的売上和帳票。全部操作不需要 Google 连接。
- Google EventID 只是可选关联；日程本体保存于系统，断开/从未开启 Google 后仍显示。
- `src/integrations/calendar-sync.js` 提供外部导入、分页、并发保护、由系统向 Google create/patch、冲突/断网提示，Google 出错不删除或回滚内部日程。
- 提供经过 mock/provider 单元验证的双向 API 适配器；**真实 Google OAuth 授权及对实际专用测试日历的读写尚未执行**。不能将 ChatGPT 已连接的日历与新网页 App 授权混为一谈。
- 第六阶段日程页将采用系统日历为主，Google 同步为可选动作；页面实际视觉设计必须先由用户确认。

## 3. Firestore 多记录事务

- `src/services/command-service.js` 读取独立业务域，执行同一条命令，比较变化，将相关 sale/payment/cashLedger/document 和版本化的 `settings/_domain_metadata` 组成一个原子 Firestore 事务。
- `src/storage/firestore-repository.js` 实现一致性版本、不可重复 operation marker、不可变 audit、正式帳票编号预留、跨账号公司权限和新 Firebase SDK 入口。
- 新业务命令的流水号由事务化 domain metadata 串行化；跨客户端版本冲突时不静默覆盖，保留操作 ID 供安全重试。
- 已通过真实 **Firebase Firestore Emulator** 的正式帳票/收款/现金全链路事务测试，正在追加多管理员并发测试。
- **写入默认关闭**，未接生产数据库或原系统线上数据。该阶段只代表业务模块和离线/持久化接口可组合，不代表所有历史兼容业务路径已一比一实现。

## 4. 新业务数据 → 原版 PDF 真正集成

- `tests/business-pdf-integration.cjs` 从**新核心 Business.perform()** 发行正式帳票生成带日期和编号的**冻结 snapshot**。
- 将同一份新 snapshot 传给原 `geruninn` HTML/PDF 渲染及 `linchen/legacy-pdf/source` 对照渲染，实际在 Chromium 中输出 PDF。
- PC 1280 / 手机 390 × estimate / invoice / receipt / onoda 16 行 / onoda 17 行 = **10 组真实 A4 PDF 验证通过**。比较页数、字段映射、发票编号、文件名、逐页 raster 像素，核对打印没有修改新业务状态。
- 原完整 PDF 源码基线另外 **14/14 组**通过。正式附件 `four-document-pdf-parity` 附真实 PDF 和 report。
- 尚需独立浏览器应用将新记录保存到 Firestore、再跨会话重下载 PDF 的全链路验收。第六阶段 UI 未经确认不做替代设计。

## 5. 不推进的边界

- 阶段 5 继续补未完成的历史业务兼容与数据接口。
- 不提前实现任何未经确认的 UI 或推送到 `main`。
- 阶段 7 的真实旧数据迁移、阶段 8 的上线切换严格暂停，直到用户批准 UI 且完成验收。
