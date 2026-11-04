import Papa from 'papaparse';
import { text, utf8 } from './github.js';
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const columnName = index => { let name = ''; for (let i = index + 1; i; i = Math.floor((i - 1) / 26)) name = String.fromCharCode(65 + (i - 1) % 26) + name; return name; };
export function parseCSV(content) {
  const parsed = Papa.parse(content, { skipEmptyLines: false });
  const serious = parsed.errors.find(error => error.code === 'MissingQuotes');
  if (serious) throw new Error('Filen har en ofullständig citering. Kontrollera CSV-filen innan du öppnar den.');
  return { data: parsed.data.map(row => row.map(value => String(value ?? ''))), delimiter: parsed.meta.delimiter || ',', newline: parsed.meta.linebreak || '\r\n', bom: content.startsWith('\uFEFF') };
}
export async function mountSheet(container, file, bytes, onChange, notice) {
  let originalHeight = 1, originalWidth = 1;
  let workbook, sheets, delimiter, newline, bom, sheetIndex = 0, selection = { r: 0, c: 0, er: 0, ec: 0 }, undoStack = [], redoStack = [], destroyed = false;
  if (/\.xlsx$/i.test(file.path)) {
    const { default: ExcelJS } = await import('exceljs');
    workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
    sheets = workbook.worksheets.map(sheet => {
      if (sheet.rowCount > 2000 || sheet.columnCount > 100) throw new Error('Tabellen är för stor för att redigeras här. Gränsen är 2 000 rader och 100 kolumner.');
      const data = [];
      for (let r = 1; r <= Math.max(sheet.rowCount, 12); r++) { const row = []; for (let c = 1; c <= Math.max(sheet.columnCount, 6); c++) {
        const cell = sheet.getCell(r, c), value = cell.value;
        row.push(value?.formula ? `=${value.formula}` : value instanceof Date ? value.toISOString().slice(0,10) : cell.text || '');
      } data.push(row); }
      return { name: sheet.name, data, changes: new Map() };
    });
    if (!sheets.length) throw new Error('Excel-filen innehåller inga blad.');
  } else {
    const parsed = parseCSV(text(bytes)); ({ delimiter, newline, bom } = parsed); originalHeight = parsed.data.length; originalWidth = Math.max(1, ...parsed.data.map(row => row.length)); sheets = [{ name: 'Tabell', data: parsed.data, changes: new Map() }];
  }
  for (const sheet of sheets) {
    if (sheet.data.length > 2000 || Math.max(...sheet.data.map(row => row.length)) > 100) throw new Error('Tabellen är för stor. Gränsen är 2 000 rader och 100 kolumner.');
    const width = Math.max(6, ...sheet.data.map(row => row.length));
    for (const row of sheet.data) while (row.length < width) row.push('');
    while (sheet.data.length < 12) sheet.data.push(Array(width).fill(''));
  }
  const data = () => sheets[sheetIndex].data;
  const range = () => ({ top: Math.min(selection.r,selection.er), bottom: Math.max(selection.r,selection.er), left: Math.min(selection.c,selection.ec), right: Math.max(selection.c,selection.ec) });
  function snapshot() { undoStack.push({ sheetIndex, rows: data().map(row => [...row]), changes: new Map(sheets[sheetIndex].changes) }); if (undoStack.length > 50) undoStack.shift(); redoStack = []; }
  function restore(from, to) { const entry = from.pop(); if (!entry) return; to.push({ sheetIndex, rows: data().map(row=>[...row]), changes: new Map(sheets[sheetIndex].changes) }); sheetIndex = entry.sheetIndex; sheets[sheetIndex].data = entry.rows; sheets[sheetIndex].changes = entry.changes; selection = {r:0,c:0,er:0,ec:0}; onChange(); render(); focus(); }
  function setCell(r,c,value) { data()[r][c] = value; sheets[sheetIndex].changes.set(`${r},${c}`,value); }
  function focus() { container.querySelector(`[data-r="${selection.r}"][data-c="${selection.c}"]`)?.focus({preventScroll:true}); container.querySelector(`[data-r="${selection.r}"][data-c="${selection.c}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'}); }
  function highlight() { const area = range(); container.querySelectorAll('td').forEach(cell => { const r=Number(cell.dataset.r),c=Number(cell.dataset.c); cell.classList.toggle('selected-cell',r>=area.top&&r<=area.bottom&&c>=area.left&&c<=area.right); cell.classList.toggle('active-cell',r===selection.r&&c===selection.c); cell.setAttribute('aria-selected',String(r>=area.top&&r<=area.bottom&&c>=area.left&&c<=area.right)); }); const address = container.querySelector('.cell-address'); if(address) address.textContent = `${columnName(selection.r===undefined?0:selection.c)}${selection.r+1}`; }
  function move(dr,dc,extend=false) { const r=Math.max(0,Math.min(data().length-1,(extend?selection.er:selection.r)+dr)),c=Math.max(0,Math.min(data()[0].length-1,(extend?selection.ec:selection.c)+dc)); selection=extend?{...selection,er:r,ec:c}:{r,c,er:r,ec:c}; highlight(); if(!extend)focus(); }
  function edit(initial) {
    const cell=container.querySelector(`[data-r="${selection.r}"][data-c="${selection.c}"]`); if(!cell||cell.querySelector('input'))return;
    const r=selection.r,c=selection.c; const input=document.createElement('input'); input.value=initial===undefined?data()[r][c]:initial; input.setAttribute('aria-label',`Värde i ${columnName(c)}${r+1}`); cell.textContent='';cell.append(input); input.focus(); if(initial===undefined)input.select();
    let done=false;
    function finish(save=true){if(done)return;done=true;if(save&&input.value!==data()[r][c]){snapshot();setCell(r,c,input.value);onChange();} render();}
    input.onblur=()=>finish();
    input.onkeydown=event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish(false);focus();}else if(['Enter','Tab','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const key=event.key;finish();move(key==='Enter'||key==='ArrowDown'?(event.shiftKey?-1:1):key==='ArrowUp'?-1:0,key==='Tab'?(event.shiftKey?-1:1):0);}};
  }
  function render() {
    if(destroyed)return;
    container.innerHTML=`<div class="sheet-tools"><span class="cell-address">${columnName(selection.c)}${selection.r+1}</span><span class="muted">Dubbelklicka för att skriva · Enter och pilar för att flytta</span><button class="secondary" data-add-row>+ Rad</button><button class="secondary" data-add-column>+ Kolumn</button></div>${workbook?`<div class="sheet-tabs">${sheets.map((s,i)=>`<button class="${i===sheetIndex?'active':''}" data-sheet="${i}">${esc(s.name)}</button>`).join('')}</div>`:''}<div class="sheet-scroll"><table class="sheet-grid" role="grid" aria-label="${esc(file.path.split('/').pop())}"><thead><tr><th></th>${data()[0].map((_,c)=>`<th scope="col">${columnName(c)}</th>`).join('')}</tr></thead><tbody>${data().map((row,r)=>`<tr><th scope="row">${r+1}</th>${row.map((value,c)=>`<td tabindex="-1" data-r="${r}" data-c="${c}" aria-label="${columnName(c)}${r+1}">${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="sheet-note">Markera flera celler med Shift + pilar eller genom att dra. Kopiera och klistra in celler med Ctrl+C och Ctrl+V.${workbook?' Formler beräknas när filen öppnas i Excel.':''}</p>`;
    container.querySelectorAll('td').forEach(cell=>{cell.onmousedown=event=>{if(event.target.tagName==='INPUT')return;event.preventDefault();const r=Number(cell.dataset.r),c=Number(cell.dataset.c);selection=event.shiftKey?{...selection,er:r,ec:c}:{r,c,er:r,ec:c};highlight();focus();};cell.onmouseenter=event=>{if(event.buttons===1&&!container.querySelector('td input')){selection.er=Number(cell.dataset.r);selection.ec=Number(cell.dataset.c);highlight();}};cell.ondblclick=()=>edit();});
    container.querySelectorAll('[data-sheet]').forEach(button=>button.onclick=()=>{sheetIndex=Number(button.dataset.sheet);selection={r:0,c:0,er:0,ec:0};render();});
    container.querySelector('[data-add-row]').onclick=()=>{if(data().length>=2000)return notice('Högst 2 000 rader kan visas.',true);snapshot();data().push(Array(data()[0].length).fill(''));if(!workbook)originalHeight=data().length;onChange();render();};
    container.querySelector('[data-add-column]').onclick=()=>{if(data()[0].length>=100)return notice('Högst 100 kolumner kan visas.',true);snapshot();data().forEach(row=>row.push(''));if(!workbook)originalWidth=data()[0].length;onChange();render();};highlight();
  }
  function onKey(event) {
    if(event.target.tagName==='INPUT')return;
    if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();event.key.toLowerCase()==='y'||event.shiftKey?restore(redoStack,undoStack):restore(undoStack,redoStack);return;}
    const directions={ArrowDown:[1,0],ArrowUp:[-1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],Enter:[event.shiftKey?-1:1,0],Tab:[0,event.shiftKey?-1:1]};
    if(directions[event.key]){event.preventDefault();move(...directions[event.key],event.shiftKey&&event.key.startsWith('Arrow'));}
    else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();snapshot();const area=range();for(let r=area.top;r<=area.bottom;r++)for(let c=area.left;c<=area.right;c++)setCell(r,c,'');onChange();render();focus();}
    else if(event.key==='F2'){event.preventDefault();edit();}
    else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();edit(event.key);}
  }
  function onCopy(event){if(event.target.tagName==='INPUT')return;const area=range(),rows=data().slice(area.top,area.bottom+1).map(row=>row.slice(area.left,area.right+1));event.clipboardData.setData('text/plain',Papa.unparse(rows,{delimiter:'\t',newline:'\n'}));event.preventDefault();}
  function onPaste(event){if(event.target.tagName==='INPUT')return;const value=event.clipboardData.getData('text/plain');if(!value)return;event.preventDefault();const pasted=Papa.parse(value,{delimiter:'\t',skipEmptyLines:false}).data;if(selection.r+pasted.length>2000||selection.c+Math.max(...pasted.map(row=>row.length))>100)return notice('Tabellen får vara högst 2 000 rader och 100 kolumner.',true);snapshot();const width=Math.max(data()[0].length,selection.c+Math.max(...pasted.map(row=>row.length)));data().forEach(row=>{while(row.length<width)row.push('');});while(data().length<selection.r+pasted.length)data().push(Array(width).fill(''));pasted.forEach((row,r)=>row.forEach((value,c)=>setCell(selection.r+r,selection.c+c,value)));onChange();render();focus();}
  container.addEventListener('keydown',onKey);container.addEventListener('copy',onCopy);container.addEventListener('paste',onPaste);render();
  return {
    async getBytes(){
      if(workbook){for(let i=0;i<sheets.length;i++)for(const [key,value]of sheets[i].changes){const[r,c]=key.split(',').map(Number);workbook.worksheets[i].getCell(r+1,c+1).value=value.startsWith('=')?{formula:value.slice(1)}:/^-?\d+(\.\d+)?$/.test(value)?Number(value):value;}return new Uint8Array(await workbook.xlsx.writeBuffer());}
      const rows=data().map(row=>[...row]);while(rows.length>originalHeight&&rows.at(-1).every(value=>value===''))rows.pop();let width=originalWidth;for(const row of rows)for(let c=row.length-1;c>=0;c--)if(row[c]!==''){width=Math.max(width,c+1);break;}return utf8.encode(`${bom?'\uFEFF':''}${Papa.unparse(rows.map(row=>row.slice(0,width)),{delimiter,newline})}`);
    },
    destroy(){destroyed=true;container.removeEventListener('keydown',onKey);container.removeEventListener('copy',onCopy);container.removeEventListener('paste',onPaste);},
  };
}
