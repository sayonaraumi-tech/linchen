/* The only Firebase SDK entry point in the new app.
 * Configuration must be injected at boot. Production writes disabled by default.
 * Never use the original geruninn project config for this independent system.
 */
import {initializeApp, getApps, getApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
import {getFirestore,doc,collection,getDoc,getDocs,query,limit} from 'firebase/firestore';
import domainGateway from './firestore-repository.js';

export function createFirebaseWebRepository({firebaseConfig,companyId,allowWrites=false,appName='tsukinowa-construction'}={}){
 if(!firebaseConfig||!firebaseConfig.projectId||!firebaseConfig.apiKey||!firebaseConfig.appId||!firebaseConfig.authDomain)throw Error('新プロジェクトのFirebase設定が必要です');
 if(firebaseConfig.projectId==='tsukinowa-business')throw Error('旧本番Firebaseへの接続は禁止されています');
 if(!companyId)throw Error('会社IDが必要です');
 if(allowWrites!==false)throw Error('正式データの更新は信頼済サーバが必要です');
 const old=getApps().find(x=>x.name===appName);
 if(old&&old.options.projectId!==firebaseConfig.projectId)throw Error('同名Firebaseアプリが別プロジェクトを参照しています');
 const app=old||initializeApp(firebaseConfig,appName);
 const auth=getAuth(app),db=getFirestore(app);
 async function getIdentity(){
  const user=auth.currentUser;
  if(!user)throw Error('Firebaseにログインしてください');
  const claim=await user.getIdTokenResult();
  return {uid:user.uid,companyId:claim.claims.companyId,role:claim.claims.role};
 }
 const sdk={doc,collection,getDoc,getDocs,limitQuery:(reference,count)=>query(reference,limit(count))};
 return {repository:domainGateway.createRepository({sdk,db,getIdentity,companyId}),auth,db,app};
}
