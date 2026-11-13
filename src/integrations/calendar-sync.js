/* Google Calendar boundary. No OAuth secrets and no writes to Google on import.
 * A formal document snapshot, sale, and payment must never be overwritten
 * by a remote calendar description.
 */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('../core/business'):root.TsukinowaCoreBusiness);if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaCalendarAdapter=api;})(globalThis,function(B){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const normalize=v=>String(v??'').trim();
function isoDay(v){let s=normalize(v);if(!s)return '';if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const d=new Date(s);if(Number.isNaN(d.valueOf()))throw Error('Invalid calendar date');return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function parseGoogleEvent(calendarId,e){
 const eventId=normalize(e?.id||e?.googleEventId);
 if(!eventId||!calendarId)throw Error('GoogleイベントIDとカレンダーIDが必要です');
 const start=e.start?.dateTime||e.start?.date||e.start||e.date;
 const end=e.end?.dateTime||e.end?.date||e.end||'';
 const date=isoDay(start);
 if(!date)throw Error('Googleイベントに日付がありません');
 return {calendarId,eventId,date,start:typeof start==='string'?start:'',end:typeof end==='string'?end:'',title:normalize(e.summary||e.title)||'予定',description:normalize(e.description),location:normalize(e.location),etag:normalize(e.etag),updated:normalize(e.updated),status:normalize(e.status)||'confirmed'};
}
const irrelevant=e=>/^(?:祝日|振替休日|国民の休日|休暇|休み|定休日|holiday|rest day)$/i.test(normalize(e.title))||e.status==='deleted';
function originalLink(state,event){
 return B.list(state,'schedule').find(r=>r.googleEventId===event.eventId&&r.calendarId===event.calendarId);
}
function eventIdentity(event){return event.calendarId+'|'+event.eventId;}
async function applyIncoming(state,{calendarId,events,digest,allowCancelled=false}){
 if(!Array.isArray(events)||typeof digest!=='function')throw Error('Calendar events and digest are required');
 let next=clone(state),added=0,updated=0,skipped=0,cancelled=0;
 for(const raw of events){
  const ev=parseGoogleEvent(calendarId,raw);
  if(irrelevant(ev)){skipped++;continue;}
  const old=originalLink(next,ev);
  if(ev.status==='cancelled'){
   cancelled++;
   if(!allowCancelled||!old){skipped++;continue;}
  }
  if(old?.googleUpdatedAt&&ev.updated&&ev.updated<old.googleUpdatedAt){skipped++;continue;}
  // A confirmed construction sale/formal invoice owns its original work identity.
  // Remote date changes require an explicit local review, never silent mutation.
  if(old&&old.date!==ev.date&&old.registeredSaleId){
   skipped++;
   if(!next.calendarConflicts)next.calendarConflicts=[];
   if(!next.calendarConflicts.some(x=>x.scheduleId===old.id&&x.googleUpdatedAt===ev.updated))
    next.calendarConflicts.push({scheduleId:old.id,calendarId,eventId:ev.eventId,
      originalDate:old.date,incomingDate:ev.date,googleUpdatedAt:ev.updated,reason:'booked-schedule-date-conflict'});
   continue;
  }
  if(old&&old.date===ev.date&&old.title===ev.title&&old.description===ev.description&&old.location===ev.location&&old.googleStatus===ev.status){skipped++;continue;}
  const key=await digest(eventIdentity(ev));
  if(!/^[a-f0-9]{32,128}$/i.test(key))throw Error('Digest output must be hex');
  const id=old?.id||'google_'+key.slice(0,40);
  const result=B.perform(next,{type:'saveSchedule',operationId:'calendar_'+key.slice(0,40)+'_'+(ev.updated?await digest(ev.updated):await digest(JSON.stringify(ev))).slice(0,24),id,date:ev.date,title:ev.title,description:ev.description,googleEventId:ev.eventId,calendarId:ev.calendarId,googleUpdatedAt:ev.updated,googleStatus:ev.status,location:ev.location,start:ev.start,end:ev.end});
  next=result.state;if(old)updated++;else added++;
 }
 return {state:next,summary:{added,updated,skipped,cancelled}};
}
async function collectPages(fetchPage,{calendarId,timeMin,timeMax}){
 if(typeof fetchPage!=='function'||!calendarId)throw Error('Calendar fetch adapter missing');
 let cursor=null,seen=new Set(),events=[];
 for(let i=0;i<100;i++){
  const response=await fetchPage({calendarId,pageToken:cursor,timeMin,timeMax});
  if(!response||!Array.isArray(response.items))throw Error('Google Calendar page is invalid');
  events.push(...response.items);
  const next=normalize(response.nextPageToken);
  if(!next)return events;
  if(seen.has(next))throw Error('Calendar pagination loop');seen.add(next);cursor=next;
 }
 throw Error('Calendar pagination exceeded limit');
}
async function patchLinkedEvent({provider,calendarId,eventId,etag,description,summary}){
 if(!provider||typeof provider.patch!=='function')throw Error('Google API provider not configured');
 if(!calendarId||!eventId)throw Error('Calendar identity missing');
 const patch={description,summary};
 try{return {status:'updated',event:await provider.patch({calendarId,eventId,etag,patch})};}
 catch(e){if(e.status===409||e.status===412)return {status:'conflict',requiresReview:true,error:String(e.message||e)};throw e;}
}

/* Explicit outbound sync: internal calendar saves succeed without this function.
 * Google writes return a link proposal, not an accounting mutation.
 */
async function pushInternalEvent({schedule,calendarId,provider,digest}){
 if(!schedule?.id||!schedule.date||!schedule.title||!calendarId)throw Error('内部日程、日付、対象カレンダーが必要です');
 if(!provider||typeof provider.insert!=='function'||typeof provider.patch!=='function'||typeof provider.get!=='function'||typeof digest!=='function')throw Error('Google API接続が必要です');
 if(schedule.googleEventId&&schedule.calendarId&&schedule.calendarId!==calendarId)return {status:'requires-review',reason:'すでに別のカレンダーに紐付いています'};
 const stable=await digest('tsukinowa|'+calendarId+'|'+schedule.id);
 if(!/^[0-9a-f]{32,128}$/i.test(stable))throw Error('Invalid deterministic event digest');
 const eventId=schedule.googleEventId||'tsuki'+stable.slice(0,40);
 const body={
  summary:schedule.title,
  description:schedule.description||'',
  location:schedule.location||'',
  start:{date:schedule.date},
  end:{date:new Date(Date.parse(schedule.date+'T00:00:00Z')+86400000).toISOString().slice(0,10)},
  extendedProperties:{private:{tsukinowaScheduleId:schedule.id,tsukinowaSyncVersion:'1'}},
 };
 let result;
 try{
  if(schedule.googleEventId){
   result=await provider.patch({calendarId,eventId,etag:schedule.googleEtag||'',patch:body});
  }else{
   result=await provider.insert({calendarId,id:eventId,body:{...body,id:eventId}});
  }
 }catch(e){
  if(e.status===409&&!schedule.googleEventId){
   try{result=await provider.get({calendarId,eventId});
    if(!result||result.id!==eventId||result.extendedProperties?.private?.tsukinowaScheduleId!==schedule.id)
     throw Error('Cannot verify our original Google event');}
   catch{return {status:'requires-review',reason:'Google event identity collision',eventId};}
  }else if(e.status===409||e.status===412){
   return {status:'conflict',requiresReview:true,reason:'Google Calendarの同時変更を確認してください',eventId};
  }else{
   return {status:'pending',retryable:true,reason:String(e.message||e),eventId};
  }
 }
 if(result?.id!==eventId)throw Error('Google response identity mismatch');
 const command={
  operationId:'calendar-link-'+stable.slice(0,24)+'-'+String(result.etag||result.updated||'confirmed').replace(/[^a-z0-9]/gi,'').slice(0,24),
  type:'saveSchedule',id:schedule.id,date:schedule.date,title:schedule.title,
  customer:schedule.customer||'',description:schedule.description||'',
  projectId:schedule.projectId||'',start:schedule.start||'',end:schedule.end||'',
  location:schedule.location||'',calendarId,googleEventId:eventId,
  googleUpdatedAt:result.updated||'',googleStatus:result.status||'confirmed'
 };
 return {status:'synced',eventId,command,googleEtag:result.etag||''};
}
return {parseGoogleEvent,applyIncoming,collectPages,patchLinkedEvent,pushInternalEvent,eventIdentity};
});
