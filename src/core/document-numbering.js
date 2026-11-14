/* Shared format for all four formal document types.
 * Issue and revision reserve a number; drafts, previews and downloads never do.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaDocumentNumbers=api;})(globalThis,function(){
'use strict';
function minuteKey(at=new Date()){
 const d=at instanceof Date?at:new Date(at);
 if(Number.isNaN(d.valueOf()))throw Error('Invalid issue timestamp');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return parts.year+parts.month+parts.day+'-'+parts.hour+parts.minute;
}
function reserve(existing=[],issuedAt=new Date()){
 const key=minuteKey(issuedAt),reserved=new Set(existing.map(x=>String(x.invoiceNo||x.snapshot?.invoiceNo||'')));
 for(let index=1;index<100000;index++){
  const no=key+'-'+String(index).padStart(2,'0');
  if(!reserved.has(no))return no;
 }
 throw Error('帳票番号が不足しています');
}
function validate(no){return /^\d{8}-\d{4}-\d{2,}$/.test(String(no||''));}
return {minuteKey,reserve,validate};
});
