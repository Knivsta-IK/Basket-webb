import { accessEnvelope, decryptAccess } from './access.js';
const DATABASE = 'knivsta-material-login';
// IndexedDB can retain a non-extractable CryptoKey without exporting its key bytes.
// No plaintext password or token is written to persistent storage.
async function store(action) {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('login');
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Webbläsaren kan inte öppna den sparade inloggningen.'));
    request.onsuccess=()=>{
      const database=request.result;
      database.onversionchange=()=>database.close();
      try {
      const transaction=database.transaction('login',action==='read'?'readonly':'readwrite');
      const records=transaction.objectStore('login');
      const operation=action==='read'?records.get('current'):action==='clear'?records.delete('current'):records.put(action,'current');
      transaction.oncomplete=()=>{const result=operation.result;database.close();resolve(result);};
      transaction.onabort=()=>{database.close();reject(transaction.error||new Error('Inloggningen kunde inte sparas.'));};
      transaction.onerror=()=>{};
      } catch (error) { database.close(); reject(error); }
    };
  });
}
export async function rememberSession(name,session) {
  await store({version:1,name,key:session.key,ciphertext:session.ciphertext,envelope:session.envelope});
}
export async function forgetSession() { await store('clear'); }
export async function restoreSession() {
  let saved;
  try { saved=await store('read'); } catch { return null; }
  if(!saved)return null;
  if(saved.version!==1||!saved.name||!saved.key||saved.key.extractable!==false){await forgetSession();return null;}
  const envelope=saved.envelope||await accessEnvelope();
  try {
    const token=await decryptAccess(envelope,saved.key);
    if(!saved.envelope)await rememberSession(saved.name,{key:saved.key,ciphertext:envelope.ciphertext,envelope});
    return {name:saved.name,token,key:saved.key,ciphertext:envelope.ciphertext,envelope};
  } catch {await forgetSession();return null;}
}
export async function verifySession(session){return (await accessEnvelope()).ciphertext===session.ciphertext;}
