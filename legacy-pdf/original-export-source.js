// ARCHIVED ORIGINAL EXPORT SOURCE from geruninn/index.html
// Dependency-rich legacy code. For controlled extraction / comparison only.
// DO NOT invoke before the original invoice HTML, styles, assets, and helpers are migrated.
// No Firebase or production data connection is provided here.

function fitInvoiceToOnePage(inv = document.querySelector('.invoice'), type = docType) {
  if (!inv) return;

  const clearModes = () => {
    inv.classList.remove('compact-1', 'compact-2', 'compact-3', 'normal-16', 'multipage-onoda');
  };

  clearModes();
  inv.style.setProperty('--dens', '1');

  if (type === 'receipt') return;
  if (inv.offsetParent === null || inv.offsetHeight === 0) return;

  const PX_PER_MM = 96 / 25.4;
  const isOnodaMonthly = type === 'onoda';
  const targetPx = 289 * PX_PER_MM;

  const measure = () => {
    const prevMin = inv.style.minHeight;
    const prevHeight = inv.style.height;
    const prevMax = inv.style.maxHeight;
    inv.style.minHeight = '0';
    inv.style.height = 'auto';
    inv.style.maxHeight = 'none';
    const h = inv.scrollHeight;
    inv.style.minHeight = prevMin || '';
    inv.style.height = prevHeight || '';
    inv.style.maxHeight = prevMax || '';
    return h;
  };

  if (isOnodaMonthly) {
    const rows = Array.from(inv.querySelectorAll('#invItems tr'))
      .filter(tr => !tr.classList.contains('empty') && tr.children.length).length;

    // 16行以内：完全正常比例，一页。
    if (rows <= 16) {
      inv.classList.add('normal-16');
      inv.style.setProperty('--dens', '1');
      return;
    }

    // 17行以上：不再压缩。改为多页，所有数据完整显示。
    inv.classList.add('multipage-onoda');
    inv.style.setProperty('--dens', '1');
    return;
  }

  // 一般請求書/見積書のみ、必要時に軽微調整
  let k = 1;
  let guard = 0;
  while (measure() > targetPx && k > 0.82 + 0.001 && guard < 8) {
    k = Math.max(0.82, k - 0.03);
    inv.style.setProperty('--dens', k.toFixed(3));
    guard++;
  }
}

function togglePreview() {
  const area = document.getElementById('previewArea');
  area.classList.toggle('show');
  if (area.classList.contains('show')) { fitInvoiceToOnePage(); area.scrollIntoView({ behavior: 'smooth' }); }
}

function buildPrintFilename() {
  const snapshot=collectFormState(),sale=bizState.sales.find(s=>s.id===snapshot.saleId);
  const linkedInvoice=loadConfirmedHistory().find(h=>h.documentId===sale?.documentId)||sale;
  return TsukinowaBusiness.documentFilename({...snapshot,linkedInvoice}).slice(0,-4);
}

function systemPrint() {
  try {
    const {documentId, docType: type} = collectFormState();
    const area = document.getElementById('previewArea');
    const wasHidden = !area.classList.contains('show');
    if (wasHidden) area.classList.add('show');
    fitInvoiceToOnePage(); // 印刷前に単ページへ自動フィット

    const originalTitle = document.title;
    document.title = buildPrintFilename();

    setTimeout(() => {
      try {
        const current = collectFormState();
        if(current.documentId===documentId&&current.docType===type)window.print();
      } catch (err) {
        alert('打印失败：' + err.message);
      }
      document.title = originalTitle;
      if (wasHidden) setTimeout(() => area.classList.remove('show'), 500);
    }, 200);
  } catch (e) {
    alert('错误：' + e.message);
  }
}

async function doPrint() {
  const btn = document.querySelector('.btn-print');
  const originalText = btn?.textContent;
  const sourceInvoice = document.querySelector('#previewArea .invoice')?.cloneNode(true);
  if (!sourceInvoice) return alert('帳票が見つかりません。');
  const type = docType;
  const filename = buildPrintFilename() + '.pdf';
  const widthMm = 210, heightMm = 297;
  const widthPx = Math.round(widthMm * 96 / 25.4);
  const rowCount = sourceInvoice.querySelectorAll('#invItems tr:not(.empty)').length;
  const allowMultiPage = type !== 'receipt' && (type !== 'onoda' || rowCount > 16);
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText = 'position:absolute;left:-10000px;top:0;width:210mm;pointer-events:none';
  sourceInvoice.style.cssText += ';width:210mm;margin:0;box-shadow:none;transform:none;text-size-adjust:none;-webkit-text-size-adjust:none';
  stage.append(sourceInvoice);
  try {
    if (btn) btn.textContent = 'PDF生成中...';
    document.body.append(stage);
    // Resolve the captured document's assets before measuring it at the export width.
    sourceInvoice.getBoundingClientRect();
    await Promise.all([document.fonts?.ready, ...Array.from(sourceInvoice.querySelectorAll('img'), img => img.decode())]);
    fitInvoiceToOnePage(sourceInvoice, type);
    const opt = {
      margin: 0,
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        letterRendering: true,
        backgroundColor: '#ffffff',
        windowWidth: widthPx,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        // ===== 核心修复 =====
        // html2pdf 内部建容器时用了 position:absolute + margin:auto + left:0;right:0,
        // 在手机窄视口下会把 210mm(=794px) 宽的容器水平居中——
        // 结果容器左侧坐标变成负数（如 -197px），左半边内容被推出屏幕外,
        // html2canvas 抓的 canvas 就是"半截"。
        // 这里在 onclone 阶段（document 已克隆但 canvas 还没开始绘制）把
        // 容器强制贴到 (0,0)，并显式 fix 住 invoice 元素的尺寸/样式。
        onclone: function(clonedDoc) {
          const container = clonedDoc.querySelector('.html2pdf__container');
          if (container) {
            container.style.position = 'absolute';
            container.style.left = '0';
            container.style.right = 'auto';
            container.style.top = '0';
            container.style.margin = '0';
            container.style.width = widthMm + 'mm';
          }
          const overlay = clonedDoc.querySelector('.html2pdf__overlay');
          if (overlay) {
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.right = 'auto';
            overlay.style.bottom = 'auto';
            overlay.style.width = widthMm + 'mm';
            overlay.style.overflow = 'visible';
          }
          const clonedInvoice = container?.querySelector('.invoice');
          if (clonedInvoice) {
            clonedInvoice.style.width = widthMm + 'mm';
            clonedInvoice.style.margin = '0';
            clonedInvoice.style.boxShadow = 'none';
            clonedInvoice.style.transform = 'none';
            if (type === 'receipt') {
              clonedInvoice.style.height = heightMm + 'mm';
              clonedInvoice.style.minHeight = heightMm + 'mm';
              clonedInvoice.style.maxHeight = heightMm + 'mm';
              clonedInvoice.style.overflow = 'hidden';
            } else if (allowMultiPage) {
              clonedInvoice.style.minHeight = heightMm + 'mm';
              clonedInvoice.style.height = 'auto';
              clonedInvoice.style.maxHeight = 'none';
              clonedInvoice.style.overflow = 'visible';
            }
          }
          if (clonedDoc.body) {
            clonedDoc.body.style.margin = '0';
            clonedDoc.body.style.padding = '0';
            clonedDoc.body.style.background = '#fff';
          }
        }
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
        compress: true
      }
    };
    const worker = html2pdf().set(opt).from(sourceInvoice);
    const canvas = await worker.toCanvas().get('canvas');
    const pdf = await worker.toPdf().get('pdf');
    // 清空 html2pdf 已经加好的所有页
    const initPages = pdf.internal.getNumberOfPages();
    for (let i = initPages; i >= 1; i--) {
      pdf.deletePage(i);
    }
    pdf.addPage(opt.jsPDF.format, opt.jsPDF.orientation);

    const pdfWidthMm = widthMm;
    const pdfHeightMm = heightMm;

    const canvasPxPerMm = canvas.width / pdfWidthMm;
    const pagePxHeight = pdfHeightMm * canvasPxPerMm;

    if (!allowMultiPage) {
      // 単页：整个 canvas 填满 A4
      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidthMm, pdfHeightMm, undefined, 'FAST');
    } else {
      // 多页：先判断是否真要多页
      // 容差：内容超出最后一页不到 10mm 视为单页（吸收亚像素溢出）
      const tolerancePx = 10 * canvasPxPerMm;
      let effectiveHeight = canvas.height;
      if (type !== 'onoda' && effectiveHeight - pagePxHeight < tolerancePx && effectiveHeight > pagePxHeight) {
        effectiveHeight = pagePxHeight;  // 强制收回到一页
      }
      const pageCount = Math.max(1, Math.ceil(effectiveHeight / pagePxHeight));

      for (let p = 0; p < pageCount; p++) {
        if (p > 0) pdf.addPage(opt.jsPDF.format, opt.jsPDF.orientation);

        const sourceY = p * pagePxHeight;
        const sourceH = Math.min(pagePxHeight, effectiveHeight - sourceY);

        // 切片到独立 canvas
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sourceH;
        const ctx = pageCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceH, 0, 0, canvas.width, sourceH);

        const imgData = pageCanvas.toDataURL('image/jpeg', 0.98);
        const outputHeightMm = (sourceH / canvasPxPerMm);
        // 最后一页：按实际内容高度（不强制拉满），中间页：填满
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidthMm, outputHeightMm, undefined, 'FAST');
      }
    }

    pdf.save(filename);
  } catch (error) {
    alert('PDF生成に失敗しました：' + error.message);
  } finally {
    stage.remove();
    if (btn) btn.textContent = originalText;
  }
}



