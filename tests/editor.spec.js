import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { sealAccess } from '../src/access.js';
const accessPromise = sealAccess('github_pat_fake', 'en testfras med fyra ord');
import ExcelJS from 'exceljs/dist/exceljs.min.js';
const shaFor = content => createHash('sha1').update(content).digest('hex');
const contents = { 'dokument/schema.csv': 'Namn;Tid\r\nPassningar;10\r\nSkott;15', 'dokument/start.md': '# Välkommen\n\nDet här är materialet.', 'ovningar/ett.md': '# Övning ett\n\nTräna passningar.', 'ovningar/tva.md': '# Övning två\n\nTräna rörelse.', 'ovningar/tre.md': '# Övning tre\n\nTräna skott.', 'ovningar/fyra.md': '# Övning fyra\n\nTräna tillsammans.' };
let writes, stored;
test.beforeEach(async ({ page }) => {
  await page.addInitScript(()=>{window.testTouch=attrs=>({...attrs});window.testTouchEvent=(type,init={})=>{const event=new Event(type,init);Object.defineProperties(event,{touches:{value:init.touches||[]},changedTouches:{value:init.changedTouches||[]}});return event;};});
  writes = []; stored = { ...contents }; page.on('pageerror', error => console.log('PAGE ERROR', error.message));
  await page.route('https://api.github.com/repos/Knivsta-IK/Basket**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/repos/Knivsta-IK/Basket', '');
    let data = {};
    if (request.method() !== 'GET') { const body = request.postDataJSON(); writes.push({ path, body }); data = { sha: `created-${writes.length}` }; }
    else if (!path) data = { default_branch: 'main' };
    else if (path.startsWith('/git/ref/')) data = { object: { sha: 'head-1' } };
    else if (path.startsWith('/git/commits/')) data = { tree: { sha: 'tree-1' } };
    else if (path.startsWith('/git/trees/')) data = { tree: Object.entries(stored).map(([path, content], i) => ({ path, size: Buffer.byteLength(content), sha: shaFor(content), type: 'blob' })) };
    else if (path.startsWith('/git/blobs/')) { const value = Object.values(stored).find(content => shaFor(content) === path.split('/').pop()); data = { content: Buffer.from(value).toString('base64') }; }
    await route.fulfill({ json: data });
  });
  await page.route('**/access.json', async route => route.fulfill({json:await accessPromise}));
  await page.goto('/'); await page.getByLabel('Ditt namn', {exact:true}).fill('Anna Andersson'); await page.getByLabel('Lösenord', {exact:true}).fill('en testfras med fyra ord'); await page.getByRole('button', {name:'Öppna biblioteket'}).click(); await expect(page.locator('.tiptap')).toBeVisible();
});
test('en skrivyta, rubriker, formatering och ångra/gör om', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const editor = page.locator('.tiptap'); await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('En ny rad');
  await page.keyboard.press('Control+z'); await expect(editor).not.toContainText('En ny rad');
  await page.keyboard.press('Control+y'); await expect(editor).toContainText('En ny rad');
  await page.getByLabel('Texttyp').selectOption('2'); await expect(editor.locator('h2')).toContainText('En ny rad');
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.getByLabel('Texttyp').selectOption('0');
  await page.keyboard.type('- text'); await page.keyboard.press('Enter'); await page.keyboard.type('nästa punkt'); await expect(editor.locator('ul li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Spara ändringar', exact: true }).click();
  await page.getByLabel('Vad har du ändrat?').fill('Förtydligar materialet'); await page.locator('dialog').getByRole('button', { name: 'Spara ändringar', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(writes.find(w => w.path === '/git/commits').body.message).toBe('Förtydligar materialet');
  expect(writes.find(w => w.path === '/git/commits').body.author.name).toBe('Anna Andersson');
  expect(writes.find(w => w.path === '/git/commits').body.committer.name).toBe('Anna Andersson');
  expect(writes.at(-1).body.force).toBe(false); expect(errors).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
test('bilder från urklipp och droppade bilagor sparas i samma commit', async ({ page }) => {
  const editor = page.locator('.tiptap'); await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
  await editor.evaluate(element => { const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0))], 'bild.png', { type: 'image/png' })); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect(editor.locator('img')).toHaveCount(1); await expect(editor.locator('img')).toHaveAttribute('src', /^blob:/);
  await editor.evaluate(element => { const data = new DataTransfer(); data.items.add(new File(['Testfil'], 'schema.pdf', { type: 'application/pdf' })); element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: element.getBoundingClientRect().left + 10, clientY: element.getBoundingClientRect().top + 10 })); });
  await expect(editor.getByRole('link', { name: 'schema.pdf' })).toBeVisible();
  await page.getByRole('button', { name: 'Spara ändringar', exact: true }).click(); await page.getByLabel('Vad har du ändrat?').fill('Lägger till bild och schema'); await page.locator('dialog').getByRole('button', { name: 'Spara ändringar', exact: true }).click(); await expect(page.locator('dialog')).toHaveCount(0);
  const tree = writes.find(w => w.path === '/git/trees').body.tree; expect(tree).toHaveLength(3); expect(tree.some(e => e.path.startsWith('bilder/'))).toBe(true); expect(tree.some(e => e.path.startsWith('bilagor/'))).toBe(true);
});
test('intern kopiering behåller formatering, annat dokument får vanlig text', async ({ page }) => {
  const editor = page.locator('.tiptap'); await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.type('Formaterad text'); await page.keyboard.press('Control+a'); await page.getByRole('button', { name: 'Fetstil', exact: true }).click();
  const clipboard = await editor.evaluate(element => { const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true })); return { plain: data.getData('text/plain'), id: data.getData('application/x-knivsta-selection'), html: data.getData('text/html') }; });
  expect(clipboard.plain).toBe('Formaterad text'); expect(clipboard.id).toBeTruthy(); expect(clipboard.html).toBe('');
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.getByRole('button', { name: 'Fetstil', exact: true }).click();
  const paste = async () => editor.evaluate((element, clipboard) => { const data = new DataTransfer(); data.setData('text/plain', clipboard.plain); data.setData('application/x-knivsta-selection', clipboard.id); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, clipboard);
  await paste(); await expect(editor.locator('strong')).toHaveCount(2);
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-path="ovningar/ett.md"]').click(); await expect(editor).toContainText('Övning ett'); await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await paste();
  await expect(editor).toContainText('Formaterad text'); await expect(editor.locator('strong')).toHaveCount(0);
});
test('träningsbyggaren kräver fyra övningar och kan ordna om dem', async ({ page }) => {
  for (const name of ['ett', 'tva', 'tre', 'fyra']) { await page.locator(`[data-path="ovningar/${name}.md"]`).click(); await page.getByRole('button', { name: 'Till träning', exact: true }).click(); }
  await expect(page.locator('.plan-item')).toHaveCount(4); await expect(page.getByRole('button', { name: 'Spara träning', exact: true })).toBeEnabled();
  await page.getByLabel('Flytta upp Övning fyra').click(); await expect(page.locator('.plan-item').nth(2)).toContainText('Övning fyra');
  await page.getByLabel('Ta bort Övning ett').click(); await expect(page.getByRole('button', { name: 'Spara träning', exact: true })).toBeDisabled();
});
test('mobil och privat material rensas vid utloggning', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/basket-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Logga ut' }).click(); await expect(page.locator('.tiptap')).toHaveCount(0); await expect(page.locator('#password')).toHaveValue(''); await expect(page.locator('#recents')).toHaveCount(0);
});
test('filer och mappar kan klistras in eller släppas i filträdet', async ({ page }) => {
  const tree = page.locator('#tree');
  await tree.evaluate(element => { const data = new DataTransfer(); data.items.add(new File(['# Ny övning'], 'ny.md', { type: 'text/markdown' })); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect(page.locator('dialog')).toBeVisible();
  await page.getByLabel('Vad har du ändrat?').fill('Lägger till eget material'); await page.locator('dialog').getByRole('button', { name: 'Spara ändringar', exact: true }).click(); await expect(page.locator('dialog')).toHaveCount(0);
  expect(writes.find(w => w.path === '/git/trees').body.tree[0].path).toBe('ny.md');
  writes.length = 0;
  await page.locator('[data-folder="ovningar"] > summary').evaluate(element => {
    const data = new DataTransfer(); data.items.add(new File(['# Ny'], 'ny.md'));
    const entry = { name: 'Sommar', isFile: false, isDirectory: true, createReader() { let read = false; return { readEntries(resolve) { if (read) return resolve([]); read = true; resolve([{ name: 'ny.md', isFile: true, file(resolve) { resolve(new File(['# Ny'], 'ny.md')); } }]); } }; } };
    const event = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
    const original = DataTransferItem.prototype.webkitGetAsEntry;
    DataTransferItem.prototype.webkitGetAsEntry = () => entry;
    element.dispatchEvent(event);
    DataTransferItem.prototype.webkitGetAsEntry = original;
  });
  await expect(page.locator('dialog')).toBeVisible(); await page.getByLabel('Vad har du ändrat?').fill('Samlar sommarens övningar'); await page.locator('dialog').getByRole('button', { name: 'Spara ändringar', exact: true }).click(); await expect(page.locator('dialog')).toHaveCount(0);
  expect(writes.find(w => w.path === '/git/trees').body.tree[0].path).toBe('ovningar/Sommar/ny.md');
});
test('mapp kan laddas ner som zip', async ({ page }) => {
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Ladda ner mapp Övningar', exact: true }).click(); const file = await downloaded; expect(file.suggestedFilename()).toBe('ovningar.zip');
});
test('understrykning, kursiv och rubriknivå bevaras i Markdown', async ({ page }) => {
  const editor = page.locator('.tiptap'); await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.type('Viktig text'); await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Understruken', exact: true }).click(); await page.getByRole('button', { name: 'Kursiv', exact: true }).click(); await page.getByLabel('Texttyp').selectOption('3');
  await expect(editor.locator('h3 u em, h3 em u')).toContainText('Viktig text');
  await page.getByRole('button', { name: 'Spara ändringar', exact: true }).click(); await page.getByLabel('Vad har du ändrat?').fill('Förtydligar rubriken'); await page.locator('dialog').getByRole('button', { name: 'Spara ändringar', exact: true }).click(); await expect(page.locator('dialog')).toHaveCount(0);
  const md = Buffer.from(writes.find(w => w.path === '/git/blobs').body.content, 'base64').toString('utf8'); expect(md).toContain('### '); expect(md).toContain('<u>'); expect(md).toContain('*');
});

test('färgad text sparas och kan läsas igen i mörkt och ljust tema', async ({ page }) => {
  const editor = page.locator('.tiptap'); await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.type('Färgad text'); await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Textfärg', exact: true }).click(); await page.getByRole('button', { name: 'Blå', exact: true }).click();
  await expect(editor.locator('span[style]')).toHaveCSS('color', 'rgb(57, 123, 184)');
  await page.getByRole('button', { name: 'Spara ändringar', exact: true }).click(); await page.getByLabel('Vad har du ändrat?').fill('Markerar fokus med blått'); await page.locator('dialog').getByRole('button', { name: 'Spara ändringar', exact: true }).click(); await expect(page.locator('dialog')).toHaveCount(0);
  const markdown = Buffer.from(writes.find(w => w.path === '/git/blobs').body.content, 'base64').toString('utf8'); expect(markdown).toContain('<span style="color: #397bb8">');
  stored['dokument/start.md'] = markdown; await page.getByRole('button', { name: 'Hämta senaste materialet' }).click();
  await expect(editor.locator('span[style]')).toHaveCSS('color', 'rgb(57, 123, 184)');
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('.paper')).toHaveCSS('background-color', 'rgb(24, 24, 27)');
  await page.screenshot({ path: '/tmp/basket-dark.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('.paper')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});
test('CSV redigeras med pilar, Enter, cellmarkering och inklistring', async ({ page }) => {
  await page.locator('[data-path="dokument/schema.csv"]').click(); const grid = page.getByRole('grid'); await expect(grid).toBeVisible();
  await page.getByRole('gridcell', {name:'A2',exact:true}).click(); await page.keyboard.type('Ny övning'); await page.keyboard.press('Enter');
  await expect(page.getByRole('gridcell', {name:'A2',exact:true})).toHaveText('Ny övning'); await expect(page.getByRole('gridcell', {name:'A3',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(page.getByRole('gridcell', {name:'B3',exact:true})).toBeFocused();
  await page.keyboard.press('Shift+ArrowLeft'); await expect(grid.locator('.selected-cell')).toHaveCount(2);
  await grid.evaluate(element => { const data = new DataTransfer(); data.setData('text/plain','Rörelse\t20'); element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})); });
  await expect(page.getByRole('gridcell', {name:'B3',exact:true})).toHaveText('Rörelse'); await expect(page.getByRole('gridcell', {name:'C3',exact:true})).toHaveText('20');
  await page.getByRole('gridcell', {name:'B3',exact:true}).click(); await page.keyboard.press('Control+z'); await expect(page.getByRole('gridcell', {name:'B3',exact:true})).toHaveText('15'); await page.keyboard.press('Control+y'); await expect(page.getByRole('gridcell', {name:'B3',exact:true})).toHaveText('Rörelse');
  await page.getByRole('button', {name:'Spara ändringar',exact:true}).click(); await page.getByLabel('Vad har du ändrat?').fill('Uppdaterar schemat'); await page.locator('dialog').getByRole('button', {name:'Spara ändringar',exact:true}).click(); await expect(page.locator('dialog')).toHaveCount(0);
  const csv = Buffer.from(writes.find(w=>w.path==='/git/blobs').body.content,'base64').toString('utf8'); expect(csv).toContain('Ny övning;10'); expect(csv).toContain('Skott;Rörelse;20');
});
test('Word-import behåller originalet och gör redigerbar Markdown', async ({ page }) => {
  const docx = zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), 'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Viktig Wordtext</w:t></w:r></w:p></w:body></w:document>') });
  await page.getByRole('button',{name:'Ladda upp filer',exact:true}).click(); await page.locator('input[name=files]').setInputFiles({name:'Anteckningar.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(docx)}); await page.getByRole('button',{name:'Fortsätt',exact:true}).click();
  await page.getByLabel('Vad har du ändrat?').fill('Importerar Wordmaterial'); await page.locator('dialog').getByRole('button',{name:'Spara ändringar',exact:true}).click(); await expect(page.locator('dialog')).toHaveCount(0);
  const entries=writes.find(w=>w.path==='/git/trees').body.tree; expect(entries.map(e=>e.path)).toEqual(['ovningar/Anteckningar.docx','ovningar/Anteckningar.md']);
  const md=Buffer.from(writes.filter(w=>w.path==='/git/blobs')[1].body.content,'base64').toString('utf8');expect(md).toContain('**Viktig Wordtext**');
});
test('Excel-blad kan öppnas och sparas med redigerade celler', async ({ page }) => {
  const workbook=new ExcelJS.Workbook();const first=workbook.addWorksheet('Grupp A');first.addRow(['Namn','Antal']);first.addRow(['Bollar',8]);workbook.addWorksheet('Grupp B').addRow(['Andra gruppen']);const bytes=Buffer.from(await workbook.xlsx.writeBuffer());
  stored['dokument/material.xlsx']=bytes;
  await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await page.locator('[data-path="dokument/material.xlsx"]').click();await expect(page.getByRole('grid')).toBeVisible();
  await page.getByRole('gridcell',{name:'B2',exact:true}).click();await page.keyboard.type('12');await page.keyboard.press('Enter');await page.getByRole('button',{name:'Grupp B',exact:true}).click();await expect(page.getByRole('gridcell',{name:'A1',exact:true})).toHaveText('Andra gruppen');
  await page.getByRole('button',{name:'Spara ändringar',exact:true}).click();await page.getByLabel('Vad har du ändrat?').fill('Uppdaterar antalet bollar');await page.locator('dialog').getByRole('button',{name:'Spara ändringar',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);
  const saved=new ExcelJS.Workbook();await saved.xlsx.load(Buffer.from(writes.find(w=>w.path==='/git/blobs').body.content,'base64'));expect(saved.getWorksheet('Grupp A').getCell('B2').value).toBe(12);expect(saved.getWorksheet('Grupp B').getCell('A1').value).toBe('Andra gruppen');
});

test('inloggning visar bara namn och lösenord och fel lösenord når inte materialet', async ({ page }) => {
  await page.getByRole('button',{name:'Logga ut'}).click();
  expect(await page.locator('body').innerText()).not.toMatch(/github|token|åtkomstnyckel/i);
  await page.getByLabel('Ditt namn',{exact:true}).fill('Anna Andersson');await page.getByLabel('Lösenord',{exact:true}).fill('fel lösenord');await page.getByRole('button',{name:'Öppna biblioteket'}).click();await expect(page.locator('#login-error')).toContainText('Fel lösenord');await expect(page.locator('.tiptap')).toHaveCount(0);await expect(page.locator('#password')).toHaveValue('');
});

test('bildladdning visar feedback, avbryts vid nytt val och använder cache', async ({page}) => {
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');stored['bilder/test.png']=png;
  await page.getByRole('button',{name:'Hämta senaste materialet'}).click();
  let release;const gate=new Promise(resolve=>release=resolve);let requests=0;
  await page.route(`**/git/blobs/${shaFor(png)}`,async route=>{requests++;await gate;try{await route.fulfill({json:{content:png.toString('base64')}});}catch{}});
  await page.locator('[data-path="bilder/test.png"]').click();await expect(page.getByRole('status').filter({hasText:'Öppnar test.png'})).toBeVisible();
  await page.locator('[data-path="ovningar/ett.md"]').click();await expect(page.locator('.tiptap')).toContainText('Övning ett');release();await expect(page.locator('.image-view')).toHaveCount(0);
  await page.locator('[data-path="bilder/test.png"]').click();await expect(page.locator('.image-view img')).toBeVisible();const count=requests;
  await page.locator('[data-path="ovningar/ett.md"]').click();await page.locator('[data-path="bilder/test.png"]').click();await expect(page.locator('.image-view img')).toBeVisible();expect(requests).toBe(count);
});
test('uppladdning erbjuder bilder och visar egen ljus miniatyr', async ({page}) => {
  await page.getByRole('button',{name:'Ladda upp filer',exact:true}).click();await expect(page.locator('select[name=folder] option[value=bilder]')).toHaveCount(1);await page.locator('select[name=folder]').selectOption('bilder');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');await page.locator('input[name=files]').setInputFiles({name:'foto.png',mimeType:'image/png',buffer:png});await expect(page.locator('.upload-preview img')).toBeVisible();expect(await page.locator('.upload-preview img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);await expect(page.locator('.upload-preview img')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.getByRole('button',{name:'Fortsätt',exact:true}).click();await page.getByLabel('Vad har du ändrat?').fill('Lägger bilden i rätt mapp');await page.locator('dialog').getByRole('button',{name:'Spara ändringar',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);expect(writes.find(w=>w.path==='/git/trees').body.tree[0].path).toBe('bilder/foto.png');
});
test('borttagning kräver meny och bekräftelse, Delete tar inte bort', async ({page}) => {
  await page.locator('[data-path="ovningar/ett.md"]').click();await page.keyboard.press('Delete');expect(writes).toHaveLength(0);
  await page.locator('[data-file-row="ovningar/ett.md"]').click({button:'right'});await page.getByRole('button',{name:'Ta bort fil',exact:true}).click();await expect(page.getByRole('heading',{name:'Ta bort fil',exact:true})).toBeVisible();expect(writes).toHaveLength(0);await page.getByRole('button',{name:'Avbryt',exact:true}).click();expect(writes).toHaveLength(0);
  await page.getByRole('button',{name:'Alternativ för ett.md',exact:true}).click();await page.getByRole('button',{name:'Ta bort fil',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Ta bort fil',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);expect(writes.find(w=>w.path==='/git/trees').body.tree[0]).toMatchObject({path:'ovningar/ett.md',sha:null});expect(writes.some(w=>w.path==='/git/blobs')).toBe(false);
});
test('mobilens sidopanel kan svepas fram och tillbaka utan att byta fil', async ({page}) => {
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Filer',exact:true})).toBeVisible();
  await page.locator('.workspace').evaluate(element=>{const touch=window.testTouch({identifier:1,target:element,clientX:8,clientY:250});element.dispatchEvent(window.testTouchEvent('touchstart',{touches:[touch],bubbles:true}));const end=window.testTouch({identifier:1,target:element,clientX:180,clientY:255});element.dispatchEvent(window.testTouchEvent('touchmove',{touches:[end],bubbles:true,cancelable:true}));element.dispatchEvent(window.testTouchEvent('touchend',{changedTouches:[end],bubbles:true}));});await expect(page.locator('.workspace')).toHaveClass(/library-open/);await page.locator('[data-path="ovningar/ett.md"]').click();await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);await expect(page.locator('.tiptap')).toContainText('Övning ett');await page.getByRole('button',{name:'Filer',exact:true}).click();await page.locator('.sidebar').evaluate(element=>{const start=window.testTouch({identifier:1,target:element,clientX:320,clientY:250});element.dispatchEvent(window.testTouchEvent('touchstart',{touches:[start],bubbles:true}));const end=window.testTouch({identifier:1,target:element,clientX:250,clientY:255});element.dispatchEvent(window.testTouchEvent('touchmove',{touches:[end],bubbles:true,cancelable:true}));element.dispatchEvent(window.testTouchEvent('touchend',{changedTouches:[end],bubbles:true}));});await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);await expect(page.locator('.tiptap')).toContainText('Övning ett');
});
test('långtryck öppnar filmenyn på telefon', async ({page}) => {
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Filer',exact:true}).click();const row=page.locator('[data-file-row="ovningar/ett.md"]');await row.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:1,clientX:100,clientY:200});await expect(page.locator('dialog').getByRole('button',{name:'Ta bort fil',exact:true})).toBeVisible();await row.dispatchEvent('pointerup',{pointerType:'touch',pointerId:1,clientX:100,clientY:200});expect(writes).toHaveLength(0);
});

test('namn och inloggning återställs direkt efter omladdning', async ({page}) => {
  await page.reload();await expect(page.locator('.tiptap')).toBeVisible();await expect(page.locator('.user-name')).toHaveText('Anna Andersson');await expect(page.locator('#password')).toHaveCount(0);
  const saved = await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('knivsta-material-login',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('login','readonly'),get=tx.objectStore('login').get('current');get.onsuccess=()=>resolve({name:get.result.name,extractable:get.result.key.extractable,hasToken:'token'in get.result,hasPassword:'password'in get.result});tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);}));
  expect(saved).toEqual({name:'Anna Andersson',extractable:false,hasToken:false,hasPassword:false});
});
test('Logga ut tar bort den sparade inloggningen även efter omladdning', async ({page}) => {
  await page.getByRole('button',{name:'Logga ut'}).click();await expect(page.locator('#password')).toBeVisible();await page.reload();await expect(page.locator('#password')).toBeVisible();await expect(page.locator('.tiptap')).toHaveCount(0);
});
test('ändrad åtkomstkonfiguration kräver ny inloggning', async ({page}) => {
  const replacement=await sealAccess('github_pat_new','ett helt annat lösenord');await page.route('**/access.json',route=>route.fulfill({json:replacement}));await page.reload();await expect(page.locator('#password')).toBeVisible();await expect(page.locator('.tiptap')).toHaveCount(0);
});
test('tillfälligt nätverksfel raderar inte den sparade inloggningen', async ({page}) => {
  const pattern='https://api.github.com/repos/Knivsta-IK/Basket**';const offline=route=>route.abort('failed');await page.route(pattern,offline);await page.reload();await expect(page.locator('.tiptap')).toBeVisible();await expect(page.locator('#notice')).toContainText('Visar sparat material');await page.unroute(pattern,offline);await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await expect(page.locator('.tiptap')).toBeVisible();await expect(page.locator('#password')).toHaveCount(0);
});
test('utgången åtkomst återgår till inloggning utan att fastna', async ({page}) => {
  await page.route('https://api.github.com/repos/Knivsta-IK/Basket**',route=>route.fulfill({status:401,json:{message:'Unauthorized'}}));await page.reload();await expect(page.locator('#login-error')).toContainText('Åtkomsten behöver förnyas');await expect(page.locator('#password')).toBeVisible();
});

async function addTestPicture(page) {
  const uri=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=800;const c=canvas.getContext('2d');c.fillStyle='#dce4fa';c.fillRect(0,0,1000,800);c.fillStyle='#5268e8';c.fillRect(100,100,300,200);return canvas.toDataURL('image/png');});
  stored['bilder/zoom.png']=Buffer.from(uri.split(',')[1],'base64');await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await page.locator('[data-path="bilder/zoom.png"]').click();await expect(page.locator('.zoom-viewport img')).toBeVisible();
}
test('sidans bredd och fasta huvud fungerar i telefonens båda riktningar',async({page})=>{
  stored['dokument/start.md']='# Långt dokument\n\n'+Array(100).fill('Det här är en lång text som ska rulla i dokumentet.').join('\n\n');await page.getByRole('button',{name:'Hämta senaste materialet'}).click();
  for(const [width,height]of [[320,740],[390,844],[667,375],[844,390],[1440,900]]){
    await page.setViewportSize({width,height});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width>height){await expect(page.locator('.sidebar')).toBeInViewport();expect((await page.locator('.sidebar').boundingBox()).x).toBeGreaterThanOrEqual(0);await expect(page.locator('#mobile-files')).toBeHidden();}
    const before=await page.locator('.topbar').boundingBox();await page.locator('.document-area').evaluate(el=>{el.scrollTop=500;});await page.evaluate(()=>window.scrollTo(500,500));const after=await page.locator('.topbar').boundingBox();expect(after.y).toBe(before.y);expect(await page.evaluate(()=>scrollX===0&&scrollY===0)).toBe(true);
  }
});
test('kantdrag följer fingret, kort drag öppnar och mitten påverkar inte menyn',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>{const b=await page.locator('.sidebar').boundingBox();return b.x+b.width;}).toBeLessThanOrEqual(1);
  const gesture=async(startX,endX,finish=true)=>page.locator('.workspace').evaluate((element,{startX,endX,finish})=>{const t=x=>window.testTouch({identifier:1,target:element,clientX:x,clientY:240});element.dispatchEvent(window.testTouchEvent('touchstart',{touches:[t(startX)],bubbles:true}));element.dispatchEvent(window.testTouchEvent('touchmove',{touches:[t(endX)],bubbles:true,cancelable:true}));if(finish)element.dispatchEvent(window.testTouchEvent('touchend',{changedTouches:[t(endX)],bubbles:true}));},{startX,endX,finish});
  await gesture(160,300);await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);
  await gesture(8,40,false);const during=await page.locator('.sidebar').boundingBox();expect(during.x).toBeLessThan(0);expect(during.x+during.width).toBeGreaterThan(20);
  await page.locator('.workspace').evaluate(el=>el.dispatchEvent(window.testTouchEvent('touchend',{changedTouches:[window.testTouch({identifier:1,target:el,clientX:40,clientY:240})],bubbles:true})));await expect(page.locator('.workspace')).toHaveClass(/library-open/);
  await gesture(160,60);await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);await page.getByRole('button',{name:'Filer',exact:true}).click();await gesture(320,285);await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);
});
test('bilden kan zoomas och panoreras med mus och två fingrar',async({page})=>{
  await addTestPicture(page);const viewport=page.locator('.zoom-viewport'),picture=viewport.locator('img');const box=await viewport.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-600);await expect(viewport).toHaveAttribute('data-zoomed','true');const before=await picture.getAttribute('style');await page.mouse.down();await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2+30);await page.mouse.up();expect(await picture.getAttribute('style')).not.toBe(before);await page.getByRole('button',{name:'Anpassa',exact:true}).click();await expect(viewport).toHaveAttribute('data-zoomed','false');
  await page.setViewportSize({width:390,height:844});await viewport.evaluate(el=>{const rect=el.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;const e=(name,id,px)=>el.dispatchEvent(new PointerEvent(name,{pointerType:'touch',pointerId:id,clientX:px,clientY:y,bubbles:true,cancelable:true}));e('pointerdown',1,x-25);e('pointerdown',2,x+25);e('pointermove',2,x+125);e('pointerup',1,x-25);e('pointerup',2,x+125);});await expect(viewport).toHaveAttribute('data-zoomed','true');const prePan=await picture.getAttribute('style');await viewport.evaluate(el=>{const r=el.getBoundingClientRect();for(const [name,dx]of [['pointerdown',0],['pointermove',40],['pointerup',40]])el.dispatchEvent(new PointerEvent(name,{pointerType:'touch',pointerId:3,clientX:r.left+80+dx,clientY:r.top+100,bubbles:true,cancelable:true}));});expect(await picture.getAttribute('style')).not.toBe(prePan);await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);
});
test('återöppning visar krypterat cachelagrad bild utan att vänta på nätverket',async({page})=>{
  await addTestPicture(page);let blobRequests=0;const block=async route=>{if(route.request().url().includes('/git/blobs/'))blobRequests++;await new Promise(resolve=>setTimeout(resolve,1500));try{await route.continue();}catch{}};await page.route('https://api.github.com/repos/Knivsta-IK/Basket**',block);const began=Date.now();await page.reload();await expect(page.locator('.zoom-viewport img')).toBeVisible({timeout:1200});const elapsed=Date.now()-began;console.log('Cached image visible after reload (ms):',elapsed);expect(elapsed).toBeLessThan(1200);expect(blobRequests).toBe(0);
});
test('drag som börjar vid någon skärmkant flyttar aldrig en zoomad bild',async({page})=>{
  await addTestPicture(page);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Zooma in',exact:true}).click();const viewport=page.locator('.zoom-viewport'),picture=viewport.locator('img');
  for(const [from,to]of [[10,140],[380,240]]){const before=await picture.getAttribute('style');await viewport.evaluate((el,{from,to})=>{const r=el.getBoundingClientRect();for(const[name,x]of [['pointerdown',from],['pointermove',to],['pointerup',to]])el.dispatchEvent(new PointerEvent(name,{pointerType:'touch',pointerId:44,clientX:x,clientY:r.top+80,bubbles:true,cancelable:true}));},{from,to});expect(await picture.getAttribute('style')).toBe(before);}
  const before=await picture.getAttribute('style');await viewport.evaluate(el=>{const r=el.getBoundingClientRect(),t=x=>window.testTouch({identifier:7,target:el,clientX:x,clientY:r.top+80});el.dispatchEvent(window.testTouchEvent('touchstart',{touches:[t(16)],bubbles:true}));el.dispatchEvent(window.testTouchEvent('touchmove',{touches:[t(100)],bubbles:true,cancelable:true}));el.dispatchEvent(window.testTouchEvent('touchend',{changedTouches:[t(100)],bubbles:true}));});await expect(page.locator('.workspace')).toHaveClass(/library-open/);expect(await picture.getAttribute('style')).toBe(before);
  await page.locator('#library-backdrop').evaluate(el=>{const t=x=>window.testTouch({identifier:7,target:el,clientX:x,clientY:250});el.dispatchEvent(window.testTouchEvent('touchstart',{touches:[t(380)],bubbles:true}));el.dispatchEvent(window.testTouchEvent('touchmove',{touches:[t(330)],bubbles:true,cancelable:true}));el.dispatchEvent(window.testTouchEvent('touchend',{changedTouches:[t(330)],bubbles:true}));});await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);expect(await picture.getAttribute('style')).toBe(before);
});
test('äldre sparad inloggning uppgraderas utan att lösenordet måste anges igen',async({page})=>{
  await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('knivsta-material-login',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('login','readwrite'),store=tx.objectStore('login'),get=store.get('current');get.onsuccess=()=>{const old=get.result;delete old.envelope;store.put(old,'current');};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};}));await page.reload();await expect(page.locator('.tiptap')).toBeVisible();await expect(page.locator('#password')).toHaveCount(0);
});
test('utloggning tömmer även den krypterade materialcachen',async({page})=>{
  await addTestPicture(page);await page.getByRole('button',{name:'Logga ut'}).click();await expect(page.locator('#password')).toBeVisible();const count=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('knivsta-material-content',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('entries','readonly'),get=tx.objectStore('entries').count();get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();};}));expect(count).toBe(0);
});

test('vänsterdrag på en filknapp inne i menyn flyttar bara menyn',async({page,context,browserName})=>{
  test.skip(browserName !== 'chromium','Native touch injection uses Chromium CDP; engine-independent touch tests run on WebKit too.');
  await addTestPicture(page);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Zooma in',exact:true}).click();const image=page.locator('.zoom-viewport img');await page.getByRole('button',{name:'Filer',exact:true}).click();const row=page.locator('[data-path="bilder/zoom.png"]');await expect(row).toBeVisible();
  await expect.poll(async()=>Math.round((await page.locator('.sidebar').boundingBox()).x)).toBe(0);
  const box=await row.boundingBox(),x=box.x+Math.min(box.width-15,160),y=box.y+box.height/2;const before=await image.getAttribute('style');const client=await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-45,y,id:1}]});
  await expect.poll(async()=> (await page.locator('.sidebar').boundingBox()).x).toBeLessThan(-10);expect(await image.getAttribute('style')).toBe(before);expect(await page.evaluate(()=>scrollX)).toBe(0);
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-100,y,id:1}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);expect(await image.getAttribute('style')).toBe(before);await expect(page.locator('dialog')).toHaveCount(0);
});
test('bilden ignorerar även en gammal pekarfångst när menyn är öppen',async({page})=>{
  await addTestPicture(page);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Zooma in',exact:true}).click();const viewport=page.locator('.zoom-viewport'),image=viewport.locator('img');await viewport.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:91,clientX:180,clientY:350});await page.getByRole('button',{name:'Filer',exact:true}).click();const before=await image.getAttribute('style');await viewport.dispatchEvent('pointermove',{pointerType:'touch',pointerId:91,clientX:80,clientY:350});expect(await image.getAttribute('style')).toBe(before);await viewport.dispatchEvent('pointerup',{pointerType:'touch',pointerId:91,clientX:80,clientY:350});
});

test('menyn följer vänsterdrag från en filrad medan bilden förblir stilla',async({page})=>{
  await addTestPicture(page);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Zooma in',exact:true}).click();const picture=page.locator('.zoom-viewport img');await page.getByRole('button',{name:'Filer',exact:true}).click();await expect.poll(async()=>Math.round((await page.locator('.sidebar').boundingBox()).x)).toBe(0);
  const before=await picture.getAttribute('style'),button=page.locator('[data-path="bilder/zoom.png"]');await button.evaluate(el=>{const r=el.getBoundingClientRect(),touch=x=>window.testTouch({identifier:17,target:el,clientX:x,clientY:r.y+r.height/2});el.dispatchEvent(window.testTouchEvent('touchstart',{touches:[touch(170)],bubbles:true}));el.dispatchEvent(window.testTouchEvent('touchmove',{touches:[touch(120)],bubbles:true,cancelable:true}));});
  expect((await page.locator('.sidebar').boundingBox()).x).toBeLessThan(-20);expect(await picture.getAttribute('style')).toBe(before);await button.evaluate(el=>{const r=el.getBoundingClientRect();el.dispatchEvent(window.testTouchEvent('touchend',{changedTouches:[window.testTouch({identifier:17,target:el,clientX:120,clientY:r.y+r.height/2})],bubbles:true}));});await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);expect(await picture.getAttribute('style')).toBe(before);
});

async function saveMediaDocument(page) {
  await page.getByRole('button',{name:'Spara ändringar',exact:true}).click();
  await page.getByLabel('Vad har du ändrat?').fill('Lägger till skalbart material');
  await page.locator('dialog').getByRole('button',{name:'Spara ändringar',exact:true}).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  const blobs=writes.filter(w=>w.path==='/git/blobs');
  const tree=writes.find(w=>w.path==='/git/trees').body.tree;
  for(const entry of tree){const index=Number(entry.sha.replace('created-',''))-1;stored[entry.path]=Buffer.from(writes[index].body.content,'base64');}
  return Buffer.from(blobs[0].body.content,'base64').toString();
}
async function resizeMedia(page,media,dx=-100) {
  const frame=media.locator('.media-frame');await frame.click();
  await expect(media.locator('.media-resize-handle:visible')).toHaveCount(4);
  const handle=await media.locator('.handle-se').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+dx,handle.y+handle.height/2+dx/2,{steps:8});await page.mouse.up();
}
test('bildens fyra hörnhandtag ändrar storlek och storleken överlever sparning och ångra',async({page})=>{
  const buffer=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=400;c.getContext('2d').fillRect(0,0,600,400);return c.toDataURL().split(',')[1];});
  await page.locator('#image-input').setInputFiles({name:'bild.png',mimeType:'image/png',buffer:Buffer.from(buffer,'base64')});
  const media=page.locator('.tiptap .document-image');await expect(media.locator('img')).toBeVisible();
  const before=await media.locator('.media-frame').boundingBox();await resizeMedia(page,media);
  const after=await media.locator('.media-frame').boundingBox();expect(after.width).toBeLessThan(before.width-50);expect(after.width/after.height).toBeCloseTo(1.5,1);
  await page.getByRole('button',{name:'Ångra',exact:true}).click();await expect.poll(async()=>Math.round((await media.locator('.media-frame').boundingBox()).width)).toBe(Math.round(before.width));
  await page.getByRole('button',{name:'Gör om',exact:true}).click();
  const markdown=await saveMediaDocument(page);expect(markdown).toMatch(/<img src="\.\.\/bilder\/[^" ]+" alt="bild.png" width="\d+" height="\d+">/);expect(markdown).not.toContain('blob:');
  await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await expect(media.locator('img')).toBeVisible();
  await expect.poll(async()=>Math.round((await media.locator('.media-frame').boundingBox()).width)).toBe(Math.round(after.width));
});
test('video spelas och spolas i dokumentet utan textändring och sparas med storlek',async({page})=>{
  await page.locator('#image-input').setInputFiles('tests/fixtures/clip.mp4');
  const media=page.locator('.tiptap .document-video'),video=media.locator('video');await expect(video).toBeVisible();
  await media.locator('.media-frame').click();await expect(media.locator('.media-resize-handle:visible')).toHaveCount(4);
  await expect(media.getByRole('button',{name:'Spela video',exact:true})).toBeEnabled();
  await media.getByRole('button',{name:'Spela video',exact:true}).click();await expect(media.getByRole('button',{name:'Pausa video',exact:true})).toBeVisible();
  await media.getByRole('slider').evaluate(el=>{el.value='1.5';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect.poll(()=>video.evaluate(el=>el.currentTime)).toBeCloseTo(1.5,1);await expect(media.getByRole('button',{name:'Spela video',exact:true})).toBeVisible();
  await resizeMedia(page,media);const width=Math.round((await media.locator('.media-frame').boundingBox()).width);
  const markdown=await saveMediaDocument(page);expect(markdown).toMatch(/<video src="\.\.\/filmer\/.+width="\d+" height="\d+"/);expect(markdown).not.toContain('blob:');
  expect(writes.find(w=>w.path==='/git/trees').body.tree.some(e=>e.path.startsWith('filmer/'))).toBe(true);
  await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await expect(video).toBeVisible();await media.locator('.media-frame').click();await expect(media.getByRole('button',{name:'Spela video',exact:true})).toBeEnabled();
  await expect.poll(async()=>Math.round((await media.locator('.media-frame').boundingBox()).width)).toBe(width);
  await media.getByRole('button',{name:'Spela video',exact:true}).click();await expect(media.getByRole('button',{name:'Pausa video',exact:true})).toBeVisible();await media.getByRole('button',{name:'Pausa video',exact:true}).click();
  await expect(page.getByRole('button',{name:'Spara ändringar',exact:true})).toBeDisabled();
  await page.setViewportSize({width:390,height:844});await media.locator('.media-frame').click();
  await expect(media.locator('.media-resize-handle:visible')).toHaveCount(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const controlBox=await media.locator('.document-video-controls').boundingBox(),frameBox=await media.locator('.media-frame').boundingBox();expect(controlBox.y).toBeGreaterThanOrEqual(frameBox.y+frameBox.height-1);
  await page.screenshot({path:'/tmp/basket-video-mobile.png'});
});


test('video hämtas vid tryck, återanvänds från cache och följer nya filversioner',async({page})=>{
  stored['filmer/klipp.mp4']=readFileSync('tests/fixtures/clip.mp4');
  stored['dokument/video.md']='# Film\n\n<video src="../filmer/klipp.mp4" width="320" height="180" controls playsinline></video>';
  let requests=0;await page.route('**/git/blobs/'+shaFor(stored['filmer/klipp.mp4']),async route=>{requests++;await route.fallback();});
  await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await page.locator('[data-path="dokument/video.md"]').click();
  const video=page.locator('.tiptap video');await expect(video).toBeVisible();expect(requests).toBe(0);
  await page.locator('.tiptap .media-frame').click();await expect(page.getByRole('button',{name:'Spela video',exact:true})).toBeEnabled();expect(requests).toBe(1);await expect(page.getByRole('button',{name:'Spara ändringar',exact:true})).toBeDisabled();
  await page.locator('[data-path="dokument/start.md"]').click();await page.locator('[data-path="dokument/video.md"]').click();
  await page.locator('.tiptap .media-frame').click();await expect(page.getByRole('button',{name:'Spela video',exact:true})).toBeEnabled();expect(requests).toBe(1);
  const oldSource=await video.getAttribute('src'),oldVideo=await video.elementHandle();stored['filmer/klipp.mp4']=Buffer.concat([stored['filmer/klipp.mp4'],Buffer.from([0,0,0,8,102,114,101,101])]);
  await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await expect.poll(()=>oldVideo.evaluate(el=>el.isConnected)).toBe(false);await page.locator('.tiptap .media-frame').click();
  await expect(video).not.toHaveAttribute('src',oldSource);await expect(page.getByRole('button',{name:'Spela video',exact:true})).toBeEnabled();
});
test('telefonens hörnhandtag följer fingret utan att flytta sidan',async({page,context,browserName})=>{
  test.skip(browserName!=='chromium','Inbyggd pekskärm via Chromium');await page.setViewportSize({width:390,height:844});
  await page.locator('#image-input').setInputFiles('tests/fixtures/clip.mp4');const media=page.locator('.tiptap .document-video');await media.locator('.media-frame').click();
  const before=await media.locator('.media-frame').boundingBox(),handle=await media.locator('.handle-se').boundingBox(),x=handle.x+15,y=handle.y+15;
  const client=await context.newCDPSession(page);await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+60,y:y+30,id:1}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>(await media.locator('.media-frame').boundingBox()).width).toBeGreaterThan(before.width+40);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&scrollX===0)).toBe(true);await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);
});

test('redigeringsmenyn stannar på skärmen vid rullning och stora telefonknappar använder SVG',async({page})=>{
  stored['dokument/start.md']='# Långt dokument\n\n'+Array(70).fill('En instruktion som går att läsa och redigera.').join('\n\n');
  await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await expect(page.locator('.tiptap h1')).toHaveText('Långt dokument');
  for(const [width,height] of [[320,740],[390,844],[667,375],[1440,900]]){
    await page.setViewportSize({width,height});
    const toolbar=page.locator('#format-bar');await expect(toolbar).toBeVisible();const before=await toolbar.boundingBox();
    await page.locator('.document-area').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await page.locator('.tiptap p').last().click();await page.keyboard.press('End');await page.keyboard.type(' Test');
    await page.evaluate(()=>{for(const s of ['.main','.workspace','#app'])document.querySelector(s).scrollTop=200;window.scrollTo(100,200);});
    const after=await toolbar.boundingBox();expect(after.y).toBeCloseTo(before.y,0);expect(after.y).toBeGreaterThanOrEqual(0);expect(after.y+after.height).toBeLessThan(height);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&scrollY===0&&document.querySelector('.main').scrollTop===0)).toBe(true);
    for(const button of await toolbar.locator('button').all()){
      await expect(button.locator('svg')).toHaveCount(1);
      if(width<=760){const box=await button.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}
    }
    await expect(toolbar.locator('[data-format=bulletList],[data-format=orderedList]')).toHaveCount(0);
  }
  await page.setViewportSize({width:390,height:844});await expect.poll(async()=>{const b=await page.locator('.sidebar').boundingBox();return b.x+b.width;}).toBeLessThanOrEqual(1);await page.screenshot({path:'/tmp/basket-toolbar-phone.png'});
});
test('verktygsfältet följer telefonens synliga yta ovanför tangentbordet och listor startar automatiskt',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:440});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:60});visualViewport.dispatchEvent(new Event('resize'));});
  await expect.poll(()=>page.locator('#app').evaluate(el=>Math.round(el.getBoundingClientRect().height))).toBe(440);
  const toolbar=await page.locator('#format-bar').boundingBox();expect(toolbar.y).toBeGreaterThanOrEqual(60);expect(toolbar.y+toolbar.height).toBeLessThan(500);
  const editor=page.locator('.tiptap');await editor.click();await page.keyboard.press('Control+a');await page.keyboard.type('1. Första');await page.keyboard.press('Enter');await page.keyboard.type('Andra');await expect(editor.locator('ol li')).toHaveCount(2);
  await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('- Första');await page.keyboard.press('Enter');await page.keyboard.type('Andra');await expect(editor.locator('ul li')).toHaveCount(2);
});
