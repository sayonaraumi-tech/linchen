# PDF 移植与验收（未通过正式 PDF 对照）

基线：`sayonaraumi-tech/geruninn@6674e019731b7fbc490e52e32fed348f7c0b7a6d`。

已将原版 `index.html` 和运行时 16 个 `js/*.js` 文件存放至 `legacy-pdf/source/`。原版 Logo、印章保存在 HTML 中的 data:image/png;base64 资源，无需重新绘制。

原版导出：`doPrint()` → `html2pdf.js@0.10.1` → Canvas → jsPDF A4 210×297mm → PNG/JPEG 图像页切割；原代码使用 JPEG 0.98、scale=2、`onclone` 中固定左侧坐标。

保留：`fitInvoiceToOnePage()`、`buildPrintFilename()`、四类模板内容、印章、Logo、CSS、行数和分页逻辑。小野田≤16行单页，≥17行分页。不要以新模板或新 PDF 库替代原版。

## 验收路径

1. 在隔离环境提供原版静态页面与现有脚本依赖，使用固定的合成帳票，不导入客户数据。
2. 生成 estimate、invoice、receipt、onoda（1、16、17、超过 17 行）以及 PC/390px 两种视口的 PDF。
3. 同一输入分别由原 `geruninn` 与新移植模块渲染；逐页比较纸张尺寸、页数、Logo、印章、字体、金额、文件名，最终逐像素对照。
4. 测试新 PDF 的历史重下载不得额外新增 sale/payment/cashLedger，修改旧样式不得改变已冻结 PDF。
5. 当且仅当所有测试通过，才将 PDF 模块标记为锁定。

## 当前状态

**源码保存与元数据准备已完成；浏览器实际运行、PDF 导出和逐像素新旧对照尚未执行，禁止标记验证通过。**

完整旧页面只用于移植基线，不应作为新 UI，也不能直接连接正式 Firebase。新 UI 需等待用户确认。
