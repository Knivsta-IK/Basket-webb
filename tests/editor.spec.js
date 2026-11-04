import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { sealAccess } from '../src/access.js';
const accessPromise = sealAccess('github_pat_fake', 'en testfras med fyra ord');
import ExcelJS from 'exceljs/dist/exceljs.min.js';
const shaFor = content => createHash('sha1').update(content).digest('hex');
const contents = { 'dokument/schema.csv': 'Namn;Tid\r\nPassningar;10\r\nSkott;15', 'dokument/start.md': '# Välkommen\n\nDet här är materialet.', 'ovningar/ett.md': '# Övning ett\n\nTräna passningar.', 'ovningar/tva.md': '# Övning två\n\nTräna rörelse.', 'ovningar/tre.md': '# Övning tre\n\nTräna skott.', 'ovningar/fyra.md': '# Övning fyra\n\nTräna tillsammans.' };
let writes, stored;
test.beforeEach(async ({ page }) => {
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
  for (const name of ['ett', 'tva', 'tre', 'fyra']) { await page.locator(`[data-path="ovningar/${name}.md"]`).click(); await page.getByRole('button', { name: '+ Till träning', exact: true }).click(); }
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
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'☰ Filer',exact:true})).toBeVisible();
  await page.locator('.workspace').evaluate(element=>{const touch=new Touch({identifier:1,target:element,clientX:8,clientY:250});element.dispatchEvent(new TouchEvent('touchstart',{touches:[touch],bubbles:true}));const end=new Touch({identifier:1,target:element,clientX:180,clientY:255});element.dispatchEvent(new TouchEvent('touchend',{changedTouches:[end],bubbles:true}));});await expect(page.locator('.workspace')).toHaveClass(/library-open/);await page.locator('[data-path="ovningar/ett.md"]').click();await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);await expect(page.locator('.tiptap')).toContainText('Övning ett');await page.getByRole('button',{name:'☰ Filer',exact:true}).click();await page.locator('.sidebar').evaluate(element=>{const start=new Touch({identifier:1,target:element,clientX:200,clientY:250});element.dispatchEvent(new TouchEvent('touchstart',{touches:[start],bubbles:true}));const end=new Touch({identifier:1,target:element,clientX:40,clientY:255});element.dispatchEvent(new TouchEvent('touchend',{changedTouches:[end],bubbles:true}));});await expect(page.locator('.workspace')).not.toHaveClass(/library-open/);await expect(page.locator('.tiptap')).toContainText('Övning ett');
});
test('långtryck öppnar filmenyn på telefon', async ({page}) => {
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'☰ Filer',exact:true}).click();const row=page.locator('[data-file-row="ovningar/ett.md"]');await row.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:1,clientX:100,clientY:200});await expect(page.locator('dialog').getByRole('button',{name:'Ta bort fil',exact:true})).toBeVisible();await row.dispatchEvent('pointerup',{pointerType:'touch',pointerId:1,clientX:100,clientY:200});expect(writes).toHaveLength(0);
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
  const pattern='https://api.github.com/repos/Knivsta-IK/Basket**';const offline=route=>route.abort('failed');await page.route(pattern,offline);await page.reload();await expect(page.locator('#login-error')).toContainText('Kontrollera anslutningen');await page.unroute(pattern,offline);await page.getByRole('button',{name:'Försök igen',exact:true}).click();await expect(page.locator('.tiptap')).toBeVisible();await expect(page.locator('#password')).toHaveCount(0);
});
test('utgången åtkomst återgår till inloggning utan att fastna', async ({page}) => {
  await page.route('https://api.github.com/repos/Knivsta-IK/Basket',route=>route.fulfill({status:401,json:{message:'Unauthorized'}}));await page.reload();await expect(page.locator('#login-error')).toContainText('Åtkomsten behöver förnyas');await expect(page.locator('#password')).toBeVisible();
});
