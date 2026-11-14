# Stage 5 — 三条完整业务链实施及验收

日期：2026-11-13。仓库 `sayonaraumi-tech/linchen`，分支 `develop/tsukinowa-construction`。**仅独立测试工作台，未连接原 `geruninn` 或正式 Firebase，不进行正式数据迁移与生产发布。**

## 结论

在**独立业务核心 + 本机临时验证工作台 + 合成测试数据**范围内，三个用户指定的业务链已具备实际操作入口并通过自动化测试。不得将此结论扩大为旧历史数据已迁移、生产 Firebase 全链路正式验收、Google OAuth 已验证，或最终 UI 已获用户批准。

## A. 見積書 → 請求書 → 領収書

- 使用 `convertEstimateToInvoice` 从已确定 `estimate` 的原始冻结快照新建 `invoice`，保留客户、工事内容、原本编号；新請求書独立编号、一次创建 sale。
- 同一原見積再次执行转换时复用同一請求書，不重复売上或重新分配编号。已无效的原見積不得转换。
- 已登记银行入金先保持 `pending-bank`；银行明细仅与既有 payment 人工确认，确认之前不能由 `issueReceiptForPayment` 生成領収書。
- 已确认现金/银行 payment → 領収書，复用 sale/payment，保留 invoice 关联，不重复生成现金台账或应收。
- 银行明细导入绝不自动作売上，Stripe、NP、ATO 月结审核不生成会计记录。
- `tests/three-business-flows.test.cjs` 和 `tests/workbench-browser.cjs` 包含同一业务全链路与重复执行的断言。

## B. 编辑、取消、恢复、历史帳票与原版 PDF

- 客户：新增、名称/地址修改、取消、明确确认后恢复；已有引用的客户不允许通过普通改名令历史帳票失去关系。
- 施工日程：新建/修改、取消、恢复；取消过的日程不允许普通保存隐式恢复；已注册 sale/正式帳票关联的日程直接取消需特殊流程。
- 支出：新增/修改、取消、恢复；现金支出镜像仅一条现金账。编辑银行付款的记录保留原银行方式；已匹配银行的支出必须先解除照合才能取消或修改。
- 帳票履歴：查看原 snapshot、訂正版（保留历史并更新已关联 sale）、明确无效，保护已收款和历史关联。仅隔离测试记录可单条删除；转换后的見積原本被 invoice 引用时阻止直接删除。
- 原版 PDF 重新下载：`scripts/pdf-export.cjs` + `scripts/serve-workbench.cjs` 只读本机服务，直接运行冻结 `legacy-pdf/source/index.html` 的 `applyFormState / fitInvoiceToOnePage / doPrint`，使用原版文件名规则；Chromium 网络隔离，PDF 下载前后存储完全相同。该服务**不允许接触正式云端账本**。
- 曾有 PDF 失败因为原 `buildPrintFilename()` 返回不含 `.pdf` 的 basename；已按旧 `doPrint()` 的真实行为补齐扩展名，并通过真实 PDF 下载浏览器测试。
- 第六阶段正式 UI 仍未设计，临时工作台的字段/编辑表单不是最终产品。

## C. 帳票 → 売上 → 入金 → 銀行照合 → 未入金 → HOME

- 見積不计売上，請求只产生一个 sale，银行未确认 payment 不冲减已确认入金，人工照合后更新付款状态。
- 已确认 payment 复用来开領収書，売上/入金数目不变，HOME 未入金归零。
- 现金領収書生成一次 `sale + payment + cashLedger`，并通过重复提交/operationId 指纹确保不重复收款。
- 取消现金支出令 cashLedger 镜像失效，恢复只恢复已有源的镜像，避免双计；更换付款方式时现金镜像必须随源反映。
- 银行付款的支出编辑保留原付款方法，不能因为表单默认“現金”产生虚假现金支出。
- 无银行候选不能创建自造 payment、sale 或 expense；银行反照合保留原始银行证据。

## 回归证据

| 测试 | GitHub Actions 运行 | 结果 |
| --- | --- | --- |
| 核心业务、帳票转换、银行、支出、恢复与兼容性 | [core](https://github.com/sayonaraumi-tech/linchen/actions/runs/43411021837) | **110/110 通过** |
| 实际浏览器导航/按钮/完整账务链/原版 PDF 重下载 | [app](https://github.com/sayonaraumi-tech/linchen/actions/runs/43411021790) | **15/15 通过** |
| 新旧源文件冻结、原版 PDF 显示与分页 | [PDF parity](https://github.com/sayonaraumi-tech/linchen/actions/runs/43410337457) | 已通过最近一次冻结对照；曾有一个 1280px 見積 PDF 偶发像素差异，需要持续跟踪 |
| 独立 Firestore 规则及跨公司权限 | [emulator](https://github.com/sayonaraumi-tech/linchen/actions/runs/43390883470) | 之前 8/8 通过；**本轮本机工作台新增操作未对生产后端做正式验收** |

## 安全边界 / 尚未验收

1. 现有 UI 是本机测试工作台，不是最终 UI。公司正式 Firebase 未连接，独立生产级鉴权/账务不变量仍需验证。
2. 旧 `estimates`、`receivables`、`calendarLinks` 仍有历史字段兼容与模拟迁移需求，真实历史資料不能直接导入。
3. 客户、日程、帳票的完整企业业务管理界面（多明细编辑、受注、正式帳票訂正全文编辑和状态转换）需要在第六阶段 UI 审核后完善；当前临时历史界面提供查看和指定字段订正，并不能替代全量业务编辑器。
4. PDF 像素回归历史上偶发失配还未明确定位根因；不能宣称永久保证逐像素无差异。
5. 本机测试工具使用浏览器 localStorage 保存**合成数据**；实际操作账务请继续使用原系统，正式数据和 PDF 模板不变。

**PR #1 保持 Draft；未经 UI 验收不合并上线、不迁移正式财务历史。**
