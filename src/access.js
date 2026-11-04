// Only the authenticated ciphertext is published. Secrets are never bundled.
const enc = new TextEncoder();
const dec = new TextDecoder();
const CONTEXT = enc.encode('knivsta-material-access:v1');
const ITERATIONS = 600000;
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function keyFor(password, salt, iterations) {
  const source = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealAccess(secret, password) {
  if (typeof password !== 'string' || password.length < 16) throw new Error('Välj en lösenfras med minst 16 tecken, gärna flera slumpmässiga ord.');
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: CONTEXT }, key, enc.encode(secret));
  return { version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}
function validateEnvelope(envelope) {
  if (!envelope || envelope.version !== 1 || envelope.cipher !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== ITERATIONS) throw new Error('Inloggningen behöver uppdateras. Kontakta ansvarig.');
  const salt = unb64(envelope.salt), iv = unb64(envelope.iv), ciphertext = unb64(envelope.ciphertext);
  if (salt.length !== 32 || iv.length !== 12 || ciphertext.length < 17 || ciphertext.length > 8192) throw new Error('Inloggningen behöver uppdateras. Kontakta ansvarig.');
  return {salt,iv,ciphertext};
}
export async function decryptAccess(envelope, key) {
  const {iv,ciphertext}=validateEnvelope(envelope);
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: CONTEXT }, key, ciphertext));
}
export async function openAccessSession(envelope, password) {
  validateEnvelope(envelope);
  try {
    const key = await keyFor(password, unb64(envelope.salt), envelope.iterations);
    const token = await decryptAccess(envelope, key);
    return { token, key, ciphertext: envelope.ciphertext };
  } catch { throw new Error('Fel lösenord. Försök igen.'); }
}
export async function openAccess(envelope, password) { return (await openAccessSession(envelope,password)).token; }
export async function accessEnvelope() {
  if (!globalThis.crypto?.subtle) throw new Error('Öppna sidan med en säker anslutning för att logga in.');
  const response = await fetch(`${import.meta.env.BASE_URL}access.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Inloggningen är inte aktiverad ännu. Kontakta ansvarig.');
  try { const envelope = await response.json(); validateEnvelope(envelope); return envelope; }
  catch { throw new Error('Inloggningen behöver uppdateras. Kontakta ansvarig.'); }
}
export async function unlockSession(password) { return openAccessSession(await accessEnvelope(),password); }
export async function unlock(password) { return (await unlockSession(password)).token; }
