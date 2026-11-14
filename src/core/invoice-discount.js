/* Invoice-only discount adapter for frozen original PDF renderer.
 * Converts a dedicated edit control to one negative formal item, not a second
 * accounting expense. Pure: never changes the input snapshot or booked sale.
 */
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
function invoiceWithDiscount(snapshot,{yen,remark=''}={}){
 if(!snapshot||snapshot.docType!=='invoice')throw Error('値引きは通常請求書のみ指定できます');
 const amount=Number(yen);
 if(!Number.isSafeInteger(amount)||amount<=0)throw Error('値引きは正の整数円で指定してください');
 if(!Array.isArray(snapshot.items)||!snapshot.items.length)throw Error('工事明細が必要です');
 const items=copy(snapshot.items);
 if(items.some(x=>String(x.content||'').trim()==='値引き'&&Number(x.price)<0))throw Error('すでに値引き明細があります');
 const subtotal=items.reduce((n,x)=>n+(Number(x.qty)||0)*(Number(x.price)||0),0);
 const travel=Number(snapshot.travelFee)||0;
 if(!Number.isSafeInteger(subtotal+travel)||subtotal+travel<=amount)throw Error('値引き金額が工事金額以上です');
 // Existing invoice renderer and legacy domain both use Math.round(taxable * .1).
 items.push({content:'値引き',qty:1,unit:'式',unitAuto:false,price:-amount,taxable:true});
 const memo=String(remark||'').trim(),old=String(snapshot.remarks||'').trim();
 const next={...copy(snapshot),items,remarks:memo?[old,memo].filter(Boolean).join(' / '):old};
 const taxable=subtotal+travel-amount,tax=Math.round(taxable*0.1);
 const total=taxable+tax;
 if(!Number.isSafeInteger(total)||total<=0)throw Error('請求額が不正です');
 return {snapshot:next,amount:total,subtotal:taxable,tax,discount:amount};
}
module.exports={invoiceWithDiscount};
