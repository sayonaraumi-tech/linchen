const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/core/business'),{invoiceWithDiscount}=require('../src/core/invoice-discount');
const original=()=>({docType:'invoice',customerName:'合成顧客',invoiceDate:'2026-11-14',travelFee:0,remarks:'既存備考',
 items:[{content:'クロス張替',qty:50,price:1400,unit:'m',taxable:true},{content:'壁穴補修',qty:1,price:30000,unit:'箇所',taxable:true}]});
test('invoice discount maps to original PDF detail row and original remarks without modifying source',()=>{
 const snap=original(),before=JSON.stringify(snap),r=invoiceWithDiscount(snap,{yen:5000,remark:'今回特別値引き'});
 assert.equal(JSON.stringify(snap),before);
 assert.equal(r.subtotal,95000);assert.equal(r.tax,9500);assert.equal(r.amount,104500);
 assert.deepEqual(r.snapshot.items.at(-1),{content:'値引き',qty:1,unit:'式',unitAuto:false,price:-5000,taxable:true});
 assert.equal(r.snapshot.remarks,'既存備考 / 今回特別値引き');
 let s=B.emptyState('test');
 s=B.perform(s,{operationId:'discount-invoice',type:'issueDocument',docType:'invoice',sourceKey:'discount-a',snapshot:r.snapshot,amount:r.amount,issuedAt:'2026-11-14T04:00:00Z'}).state;
 assert.equal(B.list(s,'sales')[0].amount,104500);
 assert.equal(B.list(s,'documents')[0].snapshot.items.at(-1).price,-5000);
});
test('reject nonpositive, fractional, excess or repeated discounts',()=>{
 assert.throws(()=>invoiceWithDiscount(original(),{yen:-1}),/整数円/);
 assert.throws(()=>invoiceWithDiscount(original(),{yen:1.5}),/整数円/);
 assert.throws(()=>invoiceWithDiscount(original(),{yen:100000}),/以上/);
 const d=invoiceWithDiscount(original(),{yen:5000}).snapshot;
 assert.throws(()=>invoiceWithDiscount(d,{yen:1000}),/すでに/);
});
test('discount does not apply to cash receipt, estimate or special Onoda',()=>{
 for(const docType of ['receipt','estimate','onoda'])
  assert.throws(()=>invoiceWithDiscount({...original(),docType},{yen:5000}),/通常請求書/);
});
