# 独立新系统：阶段 5 本地运行与安全验收

## 使用前提

- 开发仓库：`sayonaraumi-tech/linchen`
- 分支：`develop/tsukinowa-construction`；**草稿 PR，未合并到 main**
- Node.js 22 或更新版本；本机浏览器
- **这只是用于验证业务接口的隔离临时工作台，不是第 6 阶段的 UI 定稿**
- 禁止在此输入真实客户、银行或税务资料；不应视为正式公司账簿

## 本机启动

```sh
git clone https://github.com/sayonaraumi-tech/linchen.git
cd linchen
git checkout develop/tsukinowa-construction
npm install
npm run dev
```

在同一台电脑的浏览器访问 `http://127.0.0.1:4173/app/index.html`。

- 仅监听本机 `127.0.0.1`，且服务端白名单只响应 `/app/`、`/src/` 下的静态资源，不提供任何 Firebase 凭据或 Google OAuth。
- 浏览器 CSP `connect-src 'none'` 禁止连接网络应用接口；该工作台不能主动访问生产 Firebase。
- 使用独立测试存储键 `linchen_independent_test_v1`；与旧系统本地三份存储键严格隔离。
- 测试数据在重新打开时保留；不执行自动“全库清零”；已有不关联记录可按 ID 经确认单条删除，关联记录由业务校验禁止强删。
- 设置界面支持导出测试数据备份；不会上传 GitHub。

## 目前可直接操作

| 功能 | 临时工作台的实际能力 | 暂未承诺 |
| --- | --- | --- |
| HOME | 读业务核心的收入、已确认入金、未收、费用、现金合计 | 正式跨年复杂财务分析 |
| 日程 | 月历、手动新建、Google 非必需、选择单个工事「売上登録」 | Google 正式 OAuth |
| 帳票 | 四类记录合成保存、正式编号、独立现金領収書 | 直接使用正式原版 PDF 打印和历史跨会话 PDF |
| 帳票履歴 | 记录及编号、只读旧记录、明确无效、测试单条删除 | 完整订正操作表单 |
| 売上・入金 | 指定 sale、现金/银行支付、保存后未收核对 | 退费/所有旧平台复杂情形 |
| 支出・現金 | 保存支出，真实现金才镜像现金台账 | 供应商所有历史台账表单 |
| 銀行照合 | 导入一条模拟明细，人工选择已有入金/支出确认或解除 | GMO 文件 CSV 全量上传界面 |
| 設定 | 新建测试客户、设定值、测试备份与单条删除 | 正式权限与配置编辑 |

这八个入口是**业务验证而非最终视觉设计**，后续第 6 阶段仍需要用户审核桌面/手机 UI 结构。

## 回归命令

```sh
npm test
npm run test:browser
npm run test:rules
```

- `npm test`：独立业务、月次平台核对、旧兼容、隔离事务、错误与幂等回归。
- `npm run test:browser`：需要本机先安装浏览器，`npx playwright install chromium`。验证页面真实启动、数据持久化、内部日历、现金領収、银行人工确认、测试单条删除及 HTML 转义。
- `npm run test:rules`：需要 Firebase Emulator/Java 环境；使用 `demo-tsukinowa-construction`，不连接正式数据库。
- 原版 PDF 对照运行在独立 GitHub Actions 中，依赖冻结的原仓库 SHA 和 html2pdf 0.10.1；不可用本测试工作台随意修改 PDF 模板。

## 旧版兼容审计

- 查看 `docs/LEGACY-CODE-ENTRYPOINTS.md`：17 文件、335 个具名函数、41 种命令类型的原源码静态清单。
- 查看 `docs/LEGACY-COMPATIBILITY-REPORT.md`：15 个原集合及新集合映射、重要交易关联。
- `src/compat/legacy-contract.js`：读取合成/脱敏 dump 时检查旧字段、重复 ID、正式帳票 snapshot、缺失关联与未知集合，**不写入任何数据库**。
- 可在自己的电脑用 `npm run audit:legacy -- /absolute/path/to/anonymized-legacy.json` 生成仅含字段名/数量/阻断项的报告。**禁止将真实数据导出提交到 GitHub 公开仓库**。

## 未放行的部分

- 旧估价 `estimates`、应收 `receivables` 和日历 `calendarLinks` 到新模型的全量兼容、完整历史数据并行核对尚未通过。
- 新应用连接独立 Firestore 生产级后端的身份/安全、跨会话 PDF 重下载、真实 Google Calendar 专用测试账户尚未验收。
- 当前所有成功的 Playwright、Node 和 Emulator 测试**都不授权上线、改动旧 geruninn、导入真实历史数据或开始第 8 阶段切换**。
