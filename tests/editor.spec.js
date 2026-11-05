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
async function phoneViewport(page){await page.setViewportSize({width:390,height:844});await page.evaluate(()=>Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:1}));}
async function clickTool(page,name){const button=page.getByRole('button',{name,exact:true});if(!await button.isVisible())await page.getByRole('button',{name:'Fler verktyg',exact:true}).click();await button.click();}
async function selectTextType(page,value){if(!await page.getByLabel('Texttyp',{exact:true}).isVisible())await page.getByRole('button',{name:'Fler verktyg',exact:true}).click();await page.getByLabel('Texttyp',{exact:true}).selectOption(value);}

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
  await selectTextType(page,'2'); await expect(editor.locator('h2')).toContainText('En ny rad');
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await selectTextType(page,'0');
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
  const editor = page.locator('.tiptap'); await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.type('Formaterad text'); await page.keyboard.press('Control+a'); await clickTool(page,'Fetstil');
  const clipboard = await editor.evaluate(element => { const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true })); return { plain: data.getData('text/plain'), id: data.getData('application/x-knivsta-selection'), html: data.getData('text/html') }; });
  expect(clipboard.plain).toBe('Formaterad text'); expect(clipboard.id).toBeTruthy(); expect(clipboard.html).toBe('');
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await clickTool(page,'Fetstil');
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
  await clickTool(page,'Understruken'); await clickTool(page,'Kursiv'); await selectTextType(page,'3');
  await expect(editor.locator('h3 u em, h3 em u')).toContainText('Viktig text');
  await page.getByRole('button', { name: 'Spara ändringar', exact: true }).click(); await page.getByLabel('Vad har du ändrat?').fill('Förtydligar rubriken'); await page.locator('dialog').getByRole('button', { name: 'Spara ändringar', exact: true }).click(); await expect(page.locator('dialog')).toHaveCount(0);
  const md = Buffer.from(writes.find(w => w.path === '/git/blobs').body.content, 'base64').toString('utf8'); expect(md).toContain('### '); expect(md).toContain('<u>'); expect(md).toContain('*');
});

test('färgad text sparas och kan läsas igen i mörkt och ljust tema', async ({ page }) => {
  const editor = page.locator('.tiptap'); await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.type('Färgad text'); await page.keyboard.press('Control+a');
  await clickTool(page,'Textfärg'); await page.getByRole('button', { name: 'Blå', exact: true }).click();
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
test('Word-import granskas och sparas som enbart redigerbar Markdown', async ({ page }) => {
  const docx = zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), 'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Viktig Wordtext</w:t></w:r></w:p></w:body></w:document>') });
  await page.getByRole('button',{name:'Ladda upp filer',exact:true}).click(); await page.locator('input[name=files]').setInputFiles({name:'Anteckningar.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(docx)}); await page.getByRole('button',{name:'Fortsätt',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Granska Word-importen',exact:true})).toBeVisible();await expect(page.locator('.word-import-preview')).toContainText('Viktig Wordtext');await page.getByRole('button',{name:'Fortsätt',exact:true}).click();
  await page.getByLabel('Vad har du ändrat?').fill('Importerar Wordmaterial'); await page.locator('dialog').getByRole('button',{name:'Spara ändringar',exact:true}).click(); await expect(page.locator('dialog')).toHaveCount(0);
  const entries=writes.find(w=>w.path==='/git/trees').body.tree; expect(entries.map(e=>e.path)).toEqual(['ovningar/Anteckningar.md']);
  const md=Buffer.from(writes.filter(w=>w.path==='/git/blobs')[0].body.content,'base64').toString('utf8');expect(md).toContain('**Viktig Wordtext**');
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
  await clickTool(page,'Ångra');await expect.poll(async()=>Math.round((await media.locator('.media-frame').boundingBox()).width)).toBe(Math.round(before.width));
  await clickTool(page,'Gör om');
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
    const toolbar=page.locator('#format-bar');await expect(toolbar).toBeVisible();await page.locator('.tiptap').focus();const before=await toolbar.boundingBox();
    await page.locator('.document-area').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await page.locator('.tiptap p').last().click();await page.keyboard.press('End');await page.keyboard.type(' Test');
    await page.evaluate(()=>{for(const s of ['.main','.workspace','#app'])document.querySelector(s).scrollTop=200;window.scrollTo(100,200);});
    const after=await toolbar.boundingBox();expect(after.y).toBeCloseTo(before.y,0);expect(after.y).toBeGreaterThanOrEqual(0);expect(after.y+after.height).toBeLessThan(height);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&scrollY===0&&document.querySelector('.main').scrollTop===0)).toBe(true);
    for(const button of await toolbar.locator('button:visible').all()){
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

test('telefonens fokusläge frigör skrivytan och håller senaste verktygen på en rad',async({page})=>{
  await phoneViewport(page);await page.locator('.tiptap').click();
  await expect(page.locator('body')).toHaveClass(/editing-focus/);await expect(page.locator('.topbar')).toBeHidden();await expect(page.locator('#doc-bar')).toBeHidden();await expect(page.locator('#mobile-files')).toBeHidden();
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:380});visualViewport.dispatchEvent(new Event('resize'));});
    const toolbar=await page.locator('#format-bar').boundingBox();expect(toolbar.height).toBeLessThanOrEqual(60);
    for(const button of await page.locator('#format-bar button:visible').all()){const box=await button.boundingBox();expect(box.y).toBeCloseTo(toolbar.y+6,0);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.width).toBeGreaterThanOrEqual(44);}
    const area=await page.locator('.document-area').boundingBox();expect(area.height).toBeGreaterThan(300);
  }
  const editor=page.locator('.tiptap');await editor.locator('p').first().click();await page.keyboard.type('Tydligare instruktion');
  await editor.locator('p').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await expect.poll(()=>page.evaluate(()=>getSelection().toString())).toContain('Tydligare instruktion');
  await page.getByRole('button',{name:'Fler verktyg',exact:true}).click();await expect(page.locator('#more-tools')).toBeVisible();
  await page.getByRole('button',{name:'Understruken',exact:true}).click();await expect(editor.locator('u')).toContainText('Tydligare instruktion');await expect(page.locator('#more-tools')).toBeHidden();await expect(page.locator('.recent-tools [data-tool=underline]')).toBeVisible();
  await page.getByRole('button',{name:'Fler verktyg',exact:true}).click();await page.getByLabel('Texttyp',{exact:true}).selectOption('2');await expect(editor.locator('h2')).toContainText('Tydligare instruktion');await expect(page.locator('#more-tools')).toBeHidden();
  await page.screenshot({path:'/tmp/basket-focus-phone.png',clip:{x:0,y:0,width:390,height:380}});
  await editor.evaluate(el=>el.blur());await expect(page.locator('.topbar')).toBeVisible();await expect(page.locator('#doc-bar')).toBeVisible();await expect(page.locator('body')).not.toHaveClass(/editing-focus/);
  await page.getByRole('button',{name:'Spara ändringar',exact:true}).click();await expect(page.getByLabel('Vad har du ändrat?')).toBeVisible();
});

test('iPhones tangentbordsbock lämnar fokusläget när tangentbordet stängs utan blur',async({page})=>{
  await phoneViewport(page);const editor=page.locator('.tiptap');await editor.click();await expect(page.locator('body')).toHaveClass(/editing-focus/);
  const keyboard=height=>page.evaluate(height=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:height});visualViewport.dispatchEvent(new Event('resize'));},height);
  await keyboard(380);await expect(page.locator('body')).toHaveClass(/editing-focus/);
  await keyboard(410);await expect(page.locator('body')).toHaveClass(/editing-focus/);
  await keyboard(844);await expect(page.locator('body')).not.toHaveClass(/editing-focus/);await expect(page.locator('.topbar')).toBeVisible();await expect(page.locator('#doc-bar')).toBeVisible();await expect(editor).not.toBeFocused();
  await editor.click();await expect(page.locator('body')).toHaveClass(/editing-focus/);
});
test('iPhones tangentbordsbock lämnar fokusläget vid blur och verktyg får behålla fokusläget',async({page})=>{
  await phoneViewport(page);const editor=page.locator('.tiptap');await editor.click();
  await page.getByRole('button',{name:'Fler verktyg',exact:true}).click();await page.getByLabel('Texttyp',{exact:true}).focus();
  for(const height of [380,844]){await page.evaluate(height=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:height});visualViewport.dispatchEvent(new Event('resize'));},height);await expect(page.locator('body')).toHaveClass(/editing-focus/);}
  await page.getByLabel('Texttyp',{exact:true}).selectOption('2');await editor.click();
  await editor.evaluate(el=>el.blur());await expect(page.locator('body')).not.toHaveClass(/editing-focus/);await expect(page.locator('#doc-bar')).toBeVisible();
});


test('datorn behåller normal vy vid redigering och sidan har ingen egen bock',async({page})=>{
  await page.evaluate(()=>Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:0}));
  for(const width of [800,1440]){await page.setViewportSize({width,height:900});await page.locator('.tiptap').click();await page.keyboard.type('Mer material');await expect(page.locator('body')).not.toHaveClass(/editing-focus/);}
  await expect(page.locator('body')).not.toHaveClass(/editing-focus/);await expect(page.locator('.topbar')).toBeVisible();await expect(page.locator('#doc-bar')).toBeVisible();await expect(page.locator('#finish-editing')).toHaveCount(0);
});

test('iPhones bock återställer normal vy när Safari bara återfår en del av höjden utan resize',async({page})=>{
  await phoneViewport(page);const editor=page.locator('.tiptap');await editor.click();
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:300});visualViewport.dispatchEvent(new Event('resize'));});
  await expect(page.locator('body')).toHaveClass(/editing-focus/);
  // Browser chrome stays expanded: the keyboard closes, but the height does not return to 844.
  await page.evaluate(()=>Object.defineProperty(visualViewport,'height',{configurable:true,value:650}));
  await expect(page.locator('body')).not.toHaveClass(/editing-focus/);await expect(page.locator('#doc-bar')).toBeVisible();
});
test('iPhones bock upptäcks även när sidan är zoomad',async({page})=>{
  await phoneViewport(page);await page.locator('.tiptap').click();
  await page.evaluate(()=>{Object.defineProperties(visualViewport,{scale:{configurable:true,value:1.2},width:{configurable:true,value:325},height:{configurable:true,value:250}});visualViewport.dispatchEvent(new Event('resize'));});
  await expect(page.locator('body')).toHaveClass(/editing-focus/);
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:550});visualViewport.dispatchEvent(new Event('resize'));});
  await expect(page.locator('body')).not.toHaveClass(/editing-focus/);
});

test('valfri felsökning kopierar bara skärmhändelser och versionsnummer',async({page})=>{
  await page.goto('/?keyboard-debug=1');await expect(page.locator('.tiptap')).toBeVisible();
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(value){window.copiedDiagnostic=value;}}}));
  await page.getByRole('button',{name:'Kopiera felsökning',exact:true}).click();
  const data=await page.evaluate(()=>window.copiedDiagnostic);expect(JSON.parse(data).version).toBe('keyboard-20261105-2');expect(JSON.parse(data).events.length).toBeGreaterThan(0);
  for(const privateValue of ['github_pat_fake','Anna Andersson','Välkommen','en testfras med fyra ord'])expect(data).not.toContain(privateValue);
});

async function openLongLibrary(page){
  for(let i=0;i<70;i++)stored[`dokument/fil-${i}.md`]=`# Fil ${i}`;
  stored['dokument/start.md']='# Material\n\n'+Array(150).fill('En lång instruktion i bakgrunden.').join('\n\n');
  await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await expect(page.locator('.tiptap h1')).toHaveText('Material');
  await page.setViewportSize({width:390,height:844});await page.locator('.document-area').evaluate(el=>el.scrollTop=400);
  await page.getByRole('button',{name:'Filer',exact:true}).click();await expect.poll(async()=>Math.round((await page.locator('.sidebar').boundingBox()).x)).toBe(0);
}
test('vertikala drag stannar i filpanelen över rubrik, knappar, bakgrund och listans kanter',async({page})=>{
  await openLongLibrary(page);const before=await page.locator('.document-area').evaluate(el=>el.scrollTop);
  const swipe=async(selector,dy)=>page.locator(selector).evaluate((el,dy)=>{const r=el.getBoundingClientRect(),y=r.y+Math.min(30,r.height/2),touch=delta=>window.testTouch({identifier:33,target:el,clientX:r.x+Math.min(60,r.width/2),clientY:y+delta});el.dispatchEvent(window.testTouchEvent('touchstart',{touches:[touch(0)],bubbles:true}));const event=window.testTouchEvent('touchmove',{touches:[touch(dy)],bubbles:true,cancelable:true});el.dispatchEvent(event);el.dispatchEvent(window.testTouchEvent('touchend',{changedTouches:[touch(dy)],bubbles:true}));return event.defaultPrevented;},dy);
  for(const selector of ['.library-title','.sidebar-bottom','#library-backdrop'])for(const dy of [3,70])expect(await swipe(selector,dy)).toBe(true);
  await page.locator('#tree').evaluate(el=>el.scrollTop=0);expect(await swipe('#tree',70)).toBe(true);
  await page.locator('#tree').evaluate(el=>el.scrollTop=el.scrollHeight);expect(await swipe('#tree',-70)).toBe(true);
  await page.locator('#tree').evaluate(el=>el.scrollTop=100);expect(await swipe('#tree',-70)).toBe(false);
  expect(await page.locator('.document-area').evaluate(el=>el.scrollTop)).toBe(before);await expect(page.locator('.workspace')).toHaveClass(/library-open/);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
});
test('riktig pekgest rullar filerna men flyttar aldrig dokumentet bakom menyn',async({page,context,browserName})=>{
  test.skip(browserName!=='chromium','Pekgester via Chromium CDP');await openLongLibrary(page);
  const before=await page.locator('.document-area').evaluate(el=>el.scrollTop),client=await context.newCDPSession(page);
  async function swipe(x,y,dy){await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=1;i<=8;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy*i/8,id:1}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  const title=await page.locator('.library-title').boundingBox();await swipe(100,title.y+15,100);
  expect(await page.locator('.document-area').evaluate(el=>el.scrollTop)).toBe(before);
  const tree=page.locator('#tree'),box=await tree.boundingBox();await tree.evaluate(el=>el.scrollTop=100);await swipe(100,box.y+box.height/2,-90);
  await expect.poll(()=>tree.evaluate(el=>el.scrollTop)).toBeGreaterThan(120);
  expect(await page.locator('.document-area').evaluate(el=>el.scrollTop)).toBe(before);await expect(page.locator('.workspace')).toHaveClass(/library-open/);expect(await page.evaluate(()=>scrollX===0&&scrollY===0)).toBe(true);
});

test('textfärg öppnas med ett riktigt tryck från telefonens verktygsmeny',async({page,browserName})=>{
  test.skip(browserName!=='webkit','WebKit pekskärm');await phoneViewport(page);const editor=page.locator('.tiptap');await editor.click();
  await editor.locator('p').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});
  const tap=async locator=>{const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);};
  await tap(page.getByRole('button',{name:'Fler verktyg',exact:true}));await expect(page.locator('#more-tools')).toBeVisible();
  await tap(page.getByRole('button',{name:'Textfärg',exact:true}));await expect(page.getByRole('heading',{name:'Välj textfärg',exact:true})).toBeVisible();
  await tap(page.getByRole('button',{name:'Blå',exact:true}));await expect(editor.locator('span[style]')).toHaveCSS('color','rgb(57, 123, 184)');
  await expect(page.locator('dialog')).toHaveCount(0);await expect(page.locator('.recent-tools #text-color')).toBeVisible();
  await tap(page.getByRole('button',{name:'Textfärg',exact:true}));await expect(page.getByRole('heading',{name:'Välj textfärg',exact:true})).toBeVisible();
});

function smallPdf(){
  const stream=text=>{const body=`BT /F1 20 Tf 30 320 Td (${text}) Tj ET\n`;return `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}endstream`;};
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',stream('Basket page one'),'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',stream('Basket page two'),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf='%PDF-1.4\n',offsets=[0];for(const [i,object]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
function smallWav(){const data=Buffer.alloc(44+16000);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(8000,24);data.writeUInt32LE(16000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(16000,40);for(let i=0;i<8000;i++)data.writeInt16LE(Math.round(Math.sin(i/8000*440*2*Math.PI)*4000),44+i*2);return data;}
test('PDF visas lokalt med flera sidor och zoom även på telefon',async({page})=>{
  stored['dokument/basket.pdf']=smallPdf();await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await page.locator('[data-path="dokument/basket.pdf"]').click();
  const canvas=page.locator('.pdf-view canvas');await expect(canvas).toHaveAttribute('aria-label','PDF sida 1');await expect(page.locator('.pdf-view output')).toHaveText('Sida 1 av 2');await expect(page.locator('.pdf-status')).toBeEmpty();
  expect(await canvas.evaluate(el=>{const pixels=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]&&pixels[i]<180&&pixels[i+1]<180&&pixels[i+2]<180)dark++;return dark;})).toBeGreaterThan(20);
  await expect.poll(()=>canvas.evaluate(el=>el.width)).toBeGreaterThan(0);await page.getByRole('button',{name:'Nästa sida',exact:true}).click();await expect(canvas).toHaveAttribute('aria-label','PDF sida 2');
  const width=await canvas.evaluate(el=>el.width);await page.getByRole('button',{name:'Zooma in PDF',exact:true}).click();await expect.poll(()=>canvas.evaluate(el=>el.width)).toBeGreaterThan(width);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Filer',exact:true}).click();await page.locator('[data-path="dokument/start.md"]').click();await expect(page.locator('.pdf-view')).toHaveCount(0);
});
test('SVG visas med zoom och externa resurser och aktivt innehåll körs inte',async({page})=>{
  stored['bilder/plan.svg']='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><script>window.svgExecuted=true</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject><image href="https://example.invalid/track.png"/><rect width="400" height="300" fill="#f0a030"/></svg>';
  let external=0;page.on('request',request=>{if(request.url().includes('example.invalid'))external++;});
  await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await page.locator('[data-path="bilder/plan.svg"]').click();await expect(page.locator('.zoom-viewport img')).toBeVisible();
  expect(await page.locator('.zoom-viewport img').evaluate(el=>el.naturalWidth)).toBe(400);expect(await page.evaluate(()=>window.svgExecuted)).toBeUndefined();expect(external).toBe(0);
  const source=await page.locator('.zoom-viewport img').evaluate(async el=>fetch(el.src).then(r=>r.text()));expect(source).not.toContain('foreignObject');expect(source).not.toContain('example.invalid');
  await page.getByRole('button',{name:'Zooma in',exact:true}).click();await expect(page.locator('.zoom-viewport')).toHaveAttribute('data-zoomed','true');
});
test('ljud kan spelas, pausas och stoppas när man byter fil',async({page})=>{
  stored['ljud/signal.wav']=smallWav();await page.getByRole('button',{name:'Hämta senaste materialet'}).click();await page.locator('[data-path="ljud/signal.wav"]').click();const audio=page.locator('audio');
  await expect(audio).toBeVisible();await expect.poll(()=>audio.evaluate(el=>el.readyState)).toBeGreaterThan(0);
  await audio.evaluate(el=>el.play());await expect.poll(()=>audio.evaluate(el=>el.paused)).toBe(false);await audio.evaluate(el=>{el.pause();el.currentTime=.5;});await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeCloseTo(.5,1);
  const handle=await audio.elementHandle();await page.locator('[data-path="dokument/start.md"]').click();expect(await handle.evaluate(el=>el.paused)).toBe(true);await expect(page.locator('audio')).toHaveCount(0);
});

test('Word-import varnar för layout som förenklas och kan avbrytas utan att spara',async({page})=>{
  const docx=zipSync({'[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),'word/document.xml':strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Text med särskild layout</w:t></w:r></w:p><w:sectPr><w:cols w:num="2"/></w:sectPr></w:body></w:document>'),'word/header1.xml':strToU8('<w:hdr/>'),'word/charts/chart1.xml':strToU8('<chart/>')});
  await page.getByRole('button',{name:'Ladda upp filer',exact:true}).click();await page.locator('input[name=files]').setInputFiles({name:'Layout.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(docx)});await page.getByRole('button',{name:'Fortsätt',exact:true}).click();
  await expect(page.locator('.import-warnings')).toContainText('Sidhuvud eller sidfot');await expect(page.locator('.import-warnings')).toContainText('Diagram');await expect(page.locator('.import-warnings')).toContainText('Flera spalter');await page.locator('dialog').getByRole('button',{name:'Avbryt',exact:true}).click();expect(writes).toHaveLength(0);
});

async function oldWordFixture(){
  const {default:CFB}=await import('cfb');const body='Äldre Wordtext med åäö\rNästa stycke\r',document=Buffer.alloc(4096),table=Buffer.alloc(21);
  document.writeUInt16LE(0xa5ec,0);document.writeUInt16LE(0xc1,2);document.writeUInt16LE(0x0200,0x0a);document.writeUInt32LE(body.length,0x4c);document.writeUInt32LE(0,0x1a2);document.writeUInt32LE(21,0x1a6);document.write(body,512,'utf16le');
  table[0]=2;table.writeUInt32LE(16,1);table.writeUInt32LE(0,5);table.writeUInt32LE(body.length,9);table.writeUInt32LE(512,15);
  const cfb=CFB.utils.cfb_new();CFB.utils.cfb_add(cfb,'WordDocument',document);CFB.utils.cfb_add(cfb,'1Table',table);return Buffer.from(CFB.write(cfb,{type:'buffer'}));
}
test('äldre DOC blir text i Markdown och originalet sparas inte',async({page})=>{
  await page.getByRole('button',{name:'Ladda upp filer',exact:true}).click();await page.locator('input[name=files]').setInputFiles({name:'Gammal.doc',mimeType:'application/msword',buffer:await oldWordFixture()});await page.getByRole('button',{name:'Fortsätt',exact:true}).click();
  await expect(page.locator('.word-import-preview')).toContainText('Äldre Wordtext med åäö');await expect(page.locator('.import-warnings')).toContainText('Bilder, tabeller och formatering');await page.getByRole('button',{name:'Fortsätt',exact:true}).click();
  await page.getByLabel('Vad har du ändrat?').fill('Importerar äldre material');await page.locator('dialog').getByRole('button',{name:'Spara ändringar',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);
  expect(writes.find(w=>w.path==='/git/trees').body.tree.map(file=>file.path)).toEqual(['ovningar/Gammal.md']);expect(Buffer.from(writes.find(w=>w.path==='/git/blobs').body.content,'base64').toString()).toContain('Nästa stycke');
});
test('Word som släpps i dokumentet blir en Markdown-bilaga',async({page})=>{
  const payload=(await oldWordFixture()).toString('base64');await page.locator('.tiptap').evaluate((el,base64)=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'Text.doc',{type:'application/msword'}));el.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true,clientX:el.getBoundingClientRect().x+15,clientY:el.getBoundingClientRect().y+15}));},payload);
  await expect(page.getByRole('heading',{name:'Granska Word-importen',exact:true})).toBeVisible();await page.getByRole('button',{name:'Fortsätt',exact:true}).click();await expect(page.locator('.tiptap').getByRole('link',{name:'Text.md',exact:true})).toBeVisible();
  await saveMediaDocument(page);const tree=writes.find(w=>w.path==='/git/trees').body.tree;expect(tree).toHaveLength(2);expect(tree.some(file=>file.path.endsWith('.doc'))).toBe(false);expect(tree.every(file=>file.path.endsWith('.md'))).toBe(true);
});
