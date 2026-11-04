import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeText, validPath, encode, decode, GitHub, utf8 } from './github.js';
import { trainingMarkdown } from './model.js';

test('oberoende textändringar slås ihop', () => {
  const result = mergeText('Ny rubrik\n\nEtt\nTvå\nTre', 'Rubrik\n\nEtt\nTvå\nTre', 'Rubrik\n\nEtt\nTvå\nNy avslutning');
  assert.equal(result.conflict, false);
  assert.equal(result.text, 'Ny rubrik\n\nEtt\nTvå\nNy avslutning');
});
test('samma stycke kräver manuellt beslut', () => {
  assert.equal(mergeText('Min ändring', 'Ursprung', 'Din ändring').conflict, true);
});
test('svenska tecken och binära filer bevaras', () => {
  const bytes = utf8.encode('Övning: åäö 🏀'); assert.deepEqual(decode(encode(bytes)), bytes);
  const binary = Uint8Array.from({ length: 30000 }, (_, i) => i % 256); assert.deepEqual(decode(encode(binary)), binary);
});
test('osäkra filnamn nekas', () => {
  for (const path of ['../token', '/root', '.github/workflows/a.yml', 'a//b', 'a/../b', 'a\\b']) assert.equal(validPath(path), false);
  assert.equal(validPath('ovningar/passning.md'), true);
});
test('träning kräver 4–6 övningar och rimliga tider', () => {
  const entry = { title: 'Övning', path: 'ovningar/a.md', content: '# Övning\n\nInstruktion', minutes: 10 };
  for (const count of [0, 3, 7]) assert.throws(() => trainingMarkdown('Pass', '', Array(count).fill(entry)));
  const output = trainingMarkdown('Tisdag', 'Ta med bollar', Array(4).fill(entry));
  assert.match(output, /4 övningar · 40 minuter/); assert.match(output, /Ta med bollar/); assert.match(output, /## 4\. Övning/);
  assert.throws(() => trainingMarkdown('Pass', '', Array(4).fill({ ...entry, minutes: NaN })));
});
test('uppdaterad fil mergas innan en commit skapas utan force-push', async () => {
  const api = new GitHub('fake'); api.branch = 'main';
  api.snapshot = async () => ({ head: 'new-head', tree: 'new-tree', files: [{ path: 'ovningar/a.md', sha: 'remote' }] });
  api.read = async ({ sha }) => utf8.encode(sha === 'base' ? 'A\n\nB\n\nC' : 'A\n\nB\n\nC ändrad');
  const calls = [];
  api.request = async (path, options) => { const body = JSON.parse(options.body); calls.push({ path, body }); return { sha: 'created' }; };
  await api.save([{ path: 'ovningar/a.md', baseSha: 'base', bytes: utf8.encode('A ändrad\n\nB\n\nC') }], 'Två ändringar', () => assert.fail('Ska mergas automatiskt'));
  assert.equal(new TextDecoder().decode(decode(calls[0].body.content)), 'A ändrad\n\nB\n\nC ändrad');
  assert.deepEqual(calls.find(c => c.path === '/git/commits').body.parents, ['new-head']);
  assert.equal(calls.at(-1).body.force, false);
});
test('avbruten konflikt skapar ingen commit', async () => {
  const api = new GitHub('fake'); api.branch = 'main';
  api.snapshot = async () => ({ head: 'new-head', tree: 'tree', files: [{ path: 'ovningar/a.md', sha: 'remote' }] });
  api.read = async ({ sha }) => utf8.encode(sha === 'base' ? 'Original' : 'Annan version');
  api.request = async () => assert.fail('Inga skrivningar före ett beslut');
  await assert.rejects(() => api.save([{ path: 'ovningar/a.md', baseSha: 'base', bytes: utf8.encode('Min version') }], 'Ändring', async () => null), /avbröts/);
});
test('bild- och bilagelänkar pekar rätt även från övningar i undermappar', () => {
  const entry = { title: 'Övning', path: 'ovningar/grupp/a.md', content: '# Övning\n\n![Bild](../../bilder/a.png)\n\n[Bilaga](../../bilagor/a.pdf)', minutes: 10 };
  const output = trainingMarkdown('Pass', '', Array(4).fill(entry));
  assert.match(output, /!\[Bild\]\(\.\.\/bilder\/a.png\)/);
  assert.match(output, /\[Bilaga\]\(\.\.\/bilagor\/a.pdf\)/);
});
test('borttagning skapar bara en träduppdatering med null-SHA', async () => {
  const api=new GitHub('fake','Anna');api.branch='main';api.snapshot=async()=>({head:'h',tree:'t',files:[{path:'bilder/a.png',sha:'old'}]});const calls=[];api.request=async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return{sha:'new'};};await api.save([{path:'bilder/a.png',baseSha:'old',delete:true}],'Tar bort bild',()=>assert.fail());assert.equal(calls.some(c=>c.path==='/git/blobs'),false);assert.deepEqual(calls[0].body.tree,[{path:'bilder/a.png',mode:'100644',type:'blob',sha:null}]);
});
test('en fil som ändrats av någon annan tas inte bort', async () => {
  const api=new GitHub('fake');api.branch='main';api.snapshot=async()=>({head:'h',tree:'t',files:[{path:'dokument/a.md',sha:'newer'}]});api.request=async()=>assert.fail('Ingen skrivning');await assert.rejects(api.save([{path:'dokument/a.md',baseSha:'old',delete:true}],'Tar bort',()=>assert.fail()),/Filen har ändrats/);
});
