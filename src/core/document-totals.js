(function(root, factory) {
  const totals = factory();
  if (typeof module === 'object' && module.exports) module.exports = totals;
  else root.TsukinowaDocumentTotals = totals;
})(globalThis, function() {
  'use strict';

  // The original renderer applies 10% to the aggregate taxable base.
  function documentTotals(snapshot) {
    if (snapshot.docType === 'receipt') return {total: snapshot.receiptTotal};
    let taxable = snapshot.travelFee || 0;
    let exempt = 0;
    for (const item of snapshot.items) {
      const line = Math.round(item.qty * 100) * item.price;
      if (!Number.isSafeInteger(line) || line % 100 !== 0) {
        throw Error('明細金額が整数円になる数量と単価を指定してください');
      }
      if (snapshot.docType === 'onoda' && item.taxable === false) exempt += line / 100;
      else taxable += line / 100;
    }
    const subtotal = taxable + exempt;
    const tax = Math.round(taxable / 10);
    const total = subtotal + tax;
    if (!Number.isSafeInteger(total) || subtotal <= 0) throw Error('帳票金額を確認してください');
    return {subtotal, tax, total};
  }

  return {documentTotals};
});
