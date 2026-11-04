import test from 'node:test';
import assert from 'node:assert/strict';
import { sealAccess, openAccess } from './access.js';
test('bara rätt lösenord öppnar den krypterade nyckeln', async () => {
  const sealed = await sealAccess('github_pat_test_secret', 'fyra slumpade ord här!');
  assert.equal(JSON.stringify(sealed).includes('github_pat_test_secret'), false);
  assert.equal(JSON.stringify(sealed).includes('fyra slumpade ord här!'), false);
  assert.equal(await openAccess(sealed, 'fyra slumpade ord här!'), 'github_pat_test_secret');
  await assert.rejects(openAccess(sealed, 'fel lösenord'), /Fel lösenord/);
  const bytes = Uint8Array.from(atob(sealed.ciphertext), c => c.charCodeAt(0)); bytes[0] ^= 1;
  await assert.rejects(openAccess({ ...sealed, ciphertext: btoa(String.fromCharCode(...bytes)) }, 'fyra slumpade ord här!'), /Fel lösenord/);
});
test('krypteringen använder nytt salt och ny IV varje gång', async () => {
  const a = await sealAccess('hemligt', 'en tillräckligt lång fras');
  const b = await sealAccess('hemligt', 'en tillräckligt lång fras');
  assert.notEqual(a.salt,b.salt);assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
  await assert.rejects(sealAccess('hemligt','kort'), /minst 16/);
});
