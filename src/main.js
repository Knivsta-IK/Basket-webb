import { icon } from './icons.js';
import { trackWorkspaceViewport } from './workspace-viewport.js';
import { Editor } from '@tiptap/core';
import { Slice, Fragment } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import DOMPurify from 'dompurify';
import { zipSync } from 'fflate';
import { GitHub, REPO, MAX_SIZE, fileLimit, utf8, text, validPath, isMarkdown, isExercise, titleOf } from './github.js';
import { trainingMarkdown } from './model.js';
import { unlockSession } from './access.js';
import { rememberSession, restoreSession, forgetSession, verifySession } from './saved-session.js';
import { richExtensions } from './rich-text.js';
import { configureContentCache, readContentCache, writeContentCache, clearContentCache, readLibraryCache, writeLibraryCache } from './content-cache.js';
import { createMediaExtensions, mountStandaloneVideo } from './document-media.js';
import { mountImageView } from './image-view.js';
import './style.css';

const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ny-fil';

const isSheet = path => /\.(csv|xlsx)$/i.test(path);
const editablePath = path => isMarkdown(path) || isSheet(path);

let displayName = '';
let api, files = [], active, editor, sheet, original = '', dirty = false, busy = false, query = '', filter = 'all', plan = [], pendingImages = new Map(), imageUrls = new Map(), cache = new Map(), openVersion = 0;
let planTitle = '', planNotes = '', clipboardCache = null, recents = [], selectedFolder = '', planDirty = false;
let imageView = null;
let stopViewportTracking = null;
let openController = null, opening = false, suppressFileClickUntil = 0;
const fileImageUrls = new Map();
const objectUrls = new Set();
function blobUrl(bytes, type) { const url = URL.createObjectURL(new Blob([bytes], { type })); objectUrls.add(url); return url; }
function clearPrivate() { stopViewportTracking?.();stopViewportTracking=null; imageView?.destroy(); imageView=null; document.body.classList.remove('workspace-open'); openController?.abort(); openController = null; opening = false; fileImageUrls.clear(); displayName = ''; sheet?.destroy(); sheet = null; editor?.destroy(); editor = null; api = null; files = []; active = null; cache.clear(); plan = []; pendingImages.clear(); imageUrls.clear(); objectUrls.forEach(URL.revokeObjectURL); objectUrls.clear(); dirty = false; original = ''; planTitle = ''; planNotes = ''; query = ''; filter = 'all'; clipboardCache = null; recents = []; selectedFolder = ''; planDirty = false; openVersion++; }
function notice(message, error = false) { const node = $('#notice'); node.textContent = message; node.className = `notice ${error ? 'error' : ''}`; node.hidden = false; clearTimeout(notice.timer); notice.timer = setTimeout(() => { node.hidden = true; }, error ? 12000 : 5500); }
function dialog(title, content, setup) {
  const node = document.createElement('dialog'); node.innerHTML = `<div class="dialog-head"><h2>${esc(title)}</h2><button type="button" class="icon-button close" aria-label="Stäng">${icon('close')}</button></div>${content}`;
  document.body.append(node); node.querySelector('.close').onclick = () => node.close();
  node.addEventListener('close', () => node.remove()); node.addEventListener('click', e => { if (e.target === node && !busy) node.close(); });
  node.showModal(); setup?.(node); return node;
}
function confirmLeave() { return !dirty || confirm('Du har osparade ändringar. Vill du lämna dem?'); }
function login() {
  document.body.classList.remove('workspace-open');
  $('#app').innerHTML = `<div class="login-page"><header class="login-brand"><span class="brand-mark">${icon('ball')}</span><span>KNIVSTA IK <b>Material</b></span></header><main class="login-card"><span class="eyebrow">VÅRT GEMENSAMMA BIBLIOTEK</span><h1>Allt material.<br>På ett ställe.</h1><p>Övningar, dokument och idéer.<br>Samla, läs och skapa tillsammans.</p><form id="login-form"><label for="name">Ditt namn</label><input id="name" type="text" autocomplete="name" placeholder="För- och efternamn" required minlength="2" maxlength="80"><label for="password">Lösenord</label><input id="password" type="password" autocomplete="current-password" spellcheck="false" placeholder="Skriv lösenordet" required><button class="primary" type="submit">Öppna biblioteket ${icon('arrow')}</button><p id="login-error" role="alert"></p></form><p class="login-help">Saknar du lösenordet? Fråga ansvarig för materialet.</p></main><footer>${icon('lock')} Ett gemensamt rum för föreningens material.</footer></div><div id="notice" class="notice" role="status" hidden></div>`;
  $('#login-form').onsubmit = async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; button.textContent = 'Öppnar…'; $('#login-error').textContent = '';
    let session;
    try {
      const name = $('#name').value.trim().replace(/\s+/g, ' ');
      if (name.length < 2) throw new Error('Skriv ditt namn för att fortsätta.');
      session = await unlockSession($('#password').value);
      $('#password').value = '';
      const client = new GitHub(session.token, name);
      const result = await client.load();
      let remembered = true;
      try { await rememberSession(name, session); } catch { remembered = false; }
      configureContentCache(session); session = null;
      await enterWorkspace(client, result, name);
      if (!remembered) notice('Du är inloggad, men webbläsaren kunde inte komma ihåg inloggningen på den här enheten.', true);
    } catch (error) { session = null; $('#password').value = ''; $('#login-error').textContent = error.message; button.disabled = false; button.innerHTML = `Öppna biblioteket ${icon('arrow')}`; }
  };
}

function workspace() {
  stopViewportTracking?.();stopViewportTracking=trackWorkspaceViewport();
  document.body.classList.add('workspace-open');
  $('#app').innerHTML = `<header class="topbar"><a class="brand" href="#" aria-label="Knivsta IK Basket"><span class="brand-mark">${icon('ball')}</span><span>KNIVSTA IK <b>MATERIAL</b></span></a><div class="top-actions"><span class="user-name">${esc(displayName)}</span><button id="plan-toggle" class="secondary">Träningspass <span id="plan-count">0/6</span></button><button id="logout" class="plain">Logga ut</button></div></header><div class="workspace"><button id="mobile-files" class="secondary mobile-files">${icon('menu')}<span>Filer</span></button><button id="library-backdrop" class="library-backdrop" aria-label="Stäng filer" hidden></button><aside class="sidebar" id="library-panel" aria-label="Materialbibliotek"><div class="sidebar-heading"><span class="eyebrow">VÅRT BIBLIOTEK</span><button class="icon-button" id="refresh" title="Hämta senaste materialet" aria-label="Hämta senaste materialet">${icon('refresh')}</button></div><div class="library-title"><h2>Material</h2><button id="toggle-library" class="secondary">Visa filer</button></div><label class="search">${icon('search')}<input id="search" type="search" placeholder="Sök bland filer…" aria-label="Sök bland filer"></label><div class="filters"><button class="active" data-filter="all">Allt</button><button data-filter="exercises">Övningar</button><button data-filter="trainings">Träningar</button></div><nav id="tree" aria-label="Mappar och filer" tabindex="0"></nav><div class="recent-files"><span class="eyebrow">SENAST ÖPPNADE</span><div id="recents"></div></div><div class="sidebar-bottom"><button id="new-file" class="primary">${icon('plus')} Nytt dokument</button><button id="upload" class="secondary">${icon('upload')} Ladda upp filer</button><p>Gemensamt material.<br>Plats för fler idéer.</p></div></aside><main class="main"><div id="doc-bar" class="doc-bar"><span>Välj ett dokument i biblioteket</span></div><div id="format-bar" class="format-bar" hidden><select id="text-style" aria-label="Texttyp"><option value="0">Brödtext</option><option value="1">Rubrik 1</option><option value="2">Rubrik 2</option><option value="3">Rubrik 3</option><option value="4">Rubrik 4</option><option value="5">Rubrik 5</option><option value="6">Rubrik 6</option></select><span class="divider"></span><button data-format="bold" aria-label="Fetstil" title="Fetstil (Ctrl+B)">${icon('bold')}</button><button data-format="italic" aria-label="Kursiv" title="Kursiv (Ctrl+I)">${icon('italic')}</button><button id="text-color" aria-label="Textfärg" title="Textfärg">${icon('color')}</button><button data-format="underline" aria-label="Understruken" title="Understruken (Ctrl+U)">${icon('underline')}</button><span class="divider"></span><button id="link" aria-label="Infoga länk" title="Infoga länk">${icon('link')}</button><button id="image" aria-label="Infoga bild eller video" title="Infoga bild eller video">${icon('media')}</button><span class="divider"></span><button data-format="undo" aria-label="Ångra" title="Ångra">${icon('undo')}</button><button data-format="redo" aria-label="Gör om" title="Gör om">${icon('redo')}</button></div><div id="document-area" class="document-area"><div class="empty"><span class="empty-ball">${icon('ball')}</span><h1>Samlat för föreningen.</h1><p>Öppna ett dokument till vänster<br>eller skapa något nytt.</p></div></div><footer class="document-footer"><span id="save-state">Föreningens gemensamma material</span><span id="word-count"></span></footer></main><aside id="planner" class="planner" hidden></aside></div><div id="notice" class="notice" role="status" hidden></div><input id="image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.mp4,.m4v,.mov,.webm" hidden>`;
  $('#logout').onclick = async () => { if (busy || !confirmLeave() || (planDirty && !confirm('Du har en osparad träning. Vill du lämna den?'))) return; try { await forgetSession(); await clearContentCache(); } catch { notice('Den sparade inloggningen kunde inte rensas. Försök igen.', true); return; } clearPrivate(); login(); };
  $('.brand').onclick = e => e.preventDefault();
  $('#search').oninput = e => { query = e.target.value; renderTree(); };
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === button)); renderTree(); });
  $('#refresh').onclick = async () => { if (busy || !confirmLeave()) return; const path = active?.path, client = api; try { const result = await client.load(); if (client !== api) return; files = result; renderTree(); const found = files.find(f => f.path === path); if (found) await openFile(found, true); else resetDocument(); notice('Materialet är uppdaterat.'); } catch (error) { notice(error.message, true); } };
  $('#toggle-library').textContent = 'Stäng'; $('#toggle-library').onclick = () => setLibraryOpen(false);
  $('#mobile-files').onclick = () => setLibraryOpen(true); $('#library-backdrop').onclick = () => setLibraryOpen(false);
  setupSwipes();
  $('#text-color').onclick = colorPalette;
  $('#new-file').onclick = newDocument; $('#upload').onclick = uploadFiles;
  $('#plan-toggle').onclick = () => { $('#planner').hidden = !$('#planner').hidden; renderPlan(); };
  $('#text-style').onchange = e => { const level = Number(e.target.value); const chain = editor.chain().focus(); level ? chain.setHeading({ level }).run() : chain.setParagraph().run(); };
  document.querySelectorAll('[data-format]').forEach(button => { button.onmousedown = e => e.preventDefault(); button.onclick = () => { const action = { bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', undo: 'undo', redo: 'redo' }[button.dataset.format]; editor.chain().focus()[action]().run(); }; });
  $('#link').onclick = addLink; $('#image').onclick = () => $('#image-input').click();
  $('#image-input').onchange = e => { [...e.target.files].forEach(file => addAttachment(file)); e.target.value = ''; };
  renderTree(); renderPlan(); setupTreeTransfers(); setupFileMenus();
}
function folderLabel(path) { const leaf = path.split('/').pop(); return ({ ovningar: 'Övningar', dokument: 'Dokument', traningar: 'Träningar', bilder: 'Bilder', filmer: 'Filmer', 'Kom-igang': 'Kom igång' })[leaf] || leaf.replace(/-/g, ' '); }
function renderTree() {
  const visible = files.filter(f => (!query || f.path.toLocaleLowerCase('sv').includes(query.toLocaleLowerCase('sv'))) && (filter === 'all' || (filter === 'exercises' ? isExercise(f.path) : f.path.startsWith('traningar/'))));
  const root = { folders: {}, files: [] };
  if (!query) for (const path of api.current?.directories || []) { if (filter === 'exercises' && !/^(ovningar|övningar)(\/|$)/i.test(path)) continue; if (filter === 'trainings' && !/^traningar(\/|$)/.test(path)) continue; let node = root; for (const part of path.split('/')) node = node.folders[part] ||= { folders: {}, files: [] }; }
  for (const file of visible) { const parts = file.path.split('/'); parts.pop(); let node = root; for (const part of parts) node = node.folders[part] ||= { folders: {}, files: [] }; node.files.push(file); }
  const draw = (node, path = '') => Object.entries(node.folders).sort(([a], [b]) => a.localeCompare(b, 'sv')).map(([name, child]) => `<details open class="tree-folder" data-folder="${esc(`${path}${name}`)}"><summary>${icon('chevron')}${icon('folder')}<span>${esc(folderLabel(name))}</span><button class="tree-download" data-download-folder="${esc(`${path}${name}`)}" aria-label="Ladda ner mapp ${esc(folderLabel(name))}" title="Ladda ner mapp">${icon('download')}</button></summary><div>${draw(child, `${path}${name}/`)}</div></details>`).join('') + node.files.sort((a, b) => a.path.localeCompare(b.path, 'sv')).map(file => `<div class="file-row" data-file-row="${esc(file.path)}"><button class="tree-file ${active?.path === file.path ? 'selected' : ''}" data-path="${esc(file.path)}" title="${esc(file.path)}">${icon('file')}<span>${esc(file.path.split('/').pop().replace(/\.(md|markdown)$/i, '').replace(/-/g, ' '))}</span>${isExercise(file.path) ? '<span class="exercise-dot" title="Övning"></span>' : ''}</button><button class="tree-download" data-download-file="${esc(file.path)}" aria-label="Ladda ner ${esc(file.path.split('/').pop())}" title="Ladda ner fil">${icon('download')}</button><button class="file-menu-button" data-menu-file="${esc(file.path)}" aria-label="Alternativ för ${esc(file.path.split('/').pop())}">${icon('more')}</button></div>`).join('');
  $('#tree').innerHTML = `<details open class="tree-folder repo-root" data-folder=""><summary>${icon('chevron')}${icon('folder')}<span>Basket</span><button class="tree-download" data-download-folder="" aria-label="Ladda ner hela Basket" title="Ladda ner hela Basket">${icon('download')}</button></summary><div>${(visible.length || Object.keys(root.folders).length) ? draw(root) : '<p class="tree-empty">Inga filer här ännu.</p>'}</div></details>`;
  $('#tree').querySelectorAll('[data-path]').forEach(button => button.onclick = () => { if (Date.now() < suppressFileClickUntil) return; openFile(files.find(f => f.path === button.dataset.path)); });
  $('#tree').querySelectorAll('[data-menu-file]').forEach(button => button.onclick = event => { event.stopPropagation(); fileMenu(files.find(file => file.path === button.dataset.menuFile)); });
  $('#tree').querySelectorAll('[data-download-file]').forEach(button => button.onclick = async () => { try { const file = files.find(f => f.path === button.dataset.downloadFile); download(await bytesOf(file), file.path.split('/').pop()); } catch (error) { notice(error.message, true); } });
  $('#tree').querySelectorAll('[data-download-folder]').forEach(button => button.onclick = event => { event.preventDefault(); event.stopPropagation(); downloadFolder(button.dataset.downloadFolder); });
  $('#tree').querySelectorAll('summary').forEach(summary => summary.addEventListener('click', () => { selectedFolder = summary.parentElement.dataset.folder; }));

}
async function bytesOf(file, signal) {
  const client = api; if (!client) throw new Error('Du är utloggad.');
  signal?.throwIfAborted();
  if (!cache.has(file.sha)) {
    const stored = await readContentCache(`blob:${file.sha}`);
    signal?.throwIfAborted();
    const bytes = stored || await client.read(file, { signal });
    signal?.throwIfAborted();
    if (client !== api) throw new Error('Sessionen har avslutats.');
    cache.set(file.sha, bytes);
    if (!stored) await writeContentCache(`blob:${file.sha}`,bytes);
  }
  return cache.get(file.sha);
}
function cachedImage(file, bytes) {
  if (!fileImageUrls.has(file.sha)) fileImageUrls.set(file.sha, blobUrl(bytes, mediaMime(file.path)));
  return fileImageUrls.get(file.sha);
}

function resolvePath(documentPath, reference) {
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith('//')) return null;
  try { const url = new URL(reference, `https://material.local/${documentPath}`); return decodeURIComponent(url.pathname.slice(1)); } catch { return null; }
}
function relativePath(from, to) { const source = from.split('/').slice(0, -1); const dest = to.split('/'); while (source[0] && source[0] === dest[0]) { source.shift(); dest.shift(); } return `${'../'.repeat(source.length)}${dest.join('/')}`; }
async function prepareImages(content, documentPath, signal) {
  const references = [...content.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)].map(m => m[1]);
  const html=document.createElement('template');html.innerHTML=content;for(const image of html.content.querySelectorAll('img[src]'))references.push(image.getAttribute('src'));
  await Promise.all(references.map(async ref => {
    const path = resolvePath(documentPath, ref), file = files.find(f => f.path === path);
    if (!file || !imageMime(path)) return;
    try { imageUrls.set(path, cachedImage(file, await bytesOf(file, signal))); }
    catch (error) { if (error.name === 'AbortError') throw error; }
  }));
}
function imageMime(path) { const ext = path.split('.').pop().toLowerCase(); return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[ext]; }
function videoMime(path) { const ext=String(path||'').split('.').pop().toLowerCase();return({mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm'})[ext]; }
function mediaMime(path){return imageMime(path)||videoMime(path);}
function documentMedia(documentPath){return createMediaExtensions({getSource:src=>{const path=resolvePath(documentPath,src),file=files.find(file=>file.path===path);return(pendingImages.has(path)?imageUrls.get(path):fileImageUrls.get(file?.sha))||'';},loadSource:async(src,signal)=>{const path=resolvePath(documentPath,src),file=files.find(file=>file.path===path);if(!file||!mediaMime(path))throw new Error('Filen finns inte i materialet.');const bytes=await bytesOf(file,signal);const url=cachedImage(file,bytes);imageUrls.set(path,url);return url;}});}
function loadingView(name) { return `<div class="file-loading" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Öppnar ${esc(name)}…</span></div>`; }
async function openFile(file, force = false) {
  if (!file || busy || (!force && !confirmLeave())) return;
  openController?.abort();
  const controller = new AbortController(); openController = controller;
  const { signal } = controller, version = ++openVersion;
  imageView?.destroy(); imageView=null; sheet?.destroy(); sheet = null; editor?.destroy(); editor = null; pendingImages.clear();
  active = file; dirty = false; original = ''; opening = true;
  recents = [file.path, ...recents.filter(p => p !== file.path)].slice(0, 4);
  renderRecents(); renderTree(); renderDocBar(); setLibraryOpen(false);
  persistLibrary();
  $('#format-bar').hidden = true;
  $('#document-area').classList.remove('has-sheet');
  $('#document-area').innerHTML = loadingView(file.path.split('/').pop());
  $('#document-area').setAttribute('aria-busy','true'); updateStatus();
  try {
    const bytes = await bytesOf(file, signal); if (version !== openVersion) return;
    const content = isMarkdown(file.path) ? text(bytes) : '';
    if (isMarkdown(file.path)) await prepareImages(content, file.path, signal);
    signal.throwIfAborted(); if (version !== openVersion) return;
    original = content;
    if (isMarkdown(file.path)) mountEditor(content);
    else if (isSheet(file.path)) {
      const { mountSheet } = await import('./sheet.js');
      signal.throwIfAborted(); if (version !== openVersion) return;
      $('#document-area').innerHTML = '<div id="sheet-view" class="sheet-view"></div>'; $('#document-area').classList.add('has-sheet');
      const result = await mountSheet($('#sheet-view'), file, bytes, () => { dirty = true; updateStatus(); }, notice);
      if (version !== openVersion) { result.destroy(); return; } sheet = result;
    } else if (imageMime(file.path)) {
      const picture = new window.Image(); picture.src = cachedImage(file, bytes); picture.alt = file.path.split('/').pop();
      await picture.decode(); signal.throwIfAborted(); if (version !== openVersion) return;
      $('#document-area').innerHTML = '<div class="image-view"></div>'; imageView=mountImageView($('#document-area .image-view'),picture);
      renderTree();
    } else if(videoMime(file.path)){
      $('#document-area').innerHTML='<div class="standalone-video"></div>';imageView=mountStandaloneVideo($('#document-area .standalone-video'),cachedImage(file,bytes),file.path.split('/').pop());
    } else {
      $('#document-area').innerHTML = `<div class="empty">${icon('file')}<h2>${esc(file.path.split('/').pop())}</h2><p>Den här filen kan laddas ner.</p><button id="attachment-download" class="primary">Ladda ner fil</button></div>`;
      $('#attachment-download').onclick = () => download(bytes, file.path.split('/').pop());
    }
  } catch (error) {
    if (version !== openVersion || error.name === 'AbortError') return;
    $('#document-area').innerHTML = `<div class="empty"><h2>Filen kunde inte öppnas</h2><p>${esc(error.message || 'Försök igen.')}</p><button id="retry-file" class="secondary">Försök igen</button></div>`;
    $('#retry-file').onclick = () => openFile(file, true);
  } finally {
    if (version === openVersion) { opening = false; $('#document-area')?.setAttribute('aria-busy','false'); updateStatus(); }
  }
}

function mountEditor(content) {
  sheet?.destroy(); sheet = null; $('#document-area').classList.remove('has-sheet');
  $('#format-bar').hidden = false;
  $('#document-area').innerHTML = '<article class="paper"><div id="editor"></div></article>';
  editor = new Editor({ element: $('#editor'), extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', title: 'Ctrl+klicka för att öppna länken' } } }), ...documentMedia(active.path), ...richExtensions(), Markdown], content, contentType: 'markdown', editorProps: { attributes: { 'aria-label': 'Dokumentets innehåll', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' }, transformPastedHTML: html => DOMPurify.sanitize(html, { FORBID_TAGS: ['img', 'iframe', 'style', 'script', 'form'] }), handleDOMEvents: { copy: cacheCopy, cut: (view, event) => { if (!cacheCopy(view, event)) return false; view.dispatch(view.state.tr.deleteSelection().scrollIntoView()); return true; } }, handleKeyDown: (_view, event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.commands.redo(); return true; } return false; }, handleClick: (_view, _pos, event) => { const anchor = event.target.closest('a'); if (!anchor || !(event.ctrlKey || event.metaKey)) return false; event.preventDefault(); openLink(anchor.getAttribute('href')); return true; }, handlePaste: (view, event) => {
    const pastedFiles = [...(event.clipboardData?.files || [])];
    if (pastedFiles.length) { event.preventDefault(); pastedFiles.forEach(addAttachment); return true; }
    const id = event.clipboardData?.getData('application/x-knivsta-selection');
    if (clipboardCache && id === clipboardCache.id && clipboardCache.path === active.path) { event.preventDefault(); view.dispatch(view.state.tr.replaceSelection(clipboardCache.slice).scrollIntoView()); return true; }
    const plain = event.clipboardData?.getData('text/plain');
    if (plain === undefined) return false;
    event.preventDefault();
    const paragraphs = plain.split(/\r?\n/).map(line => view.state.schema.nodes.paragraph.create(null, line ? view.state.schema.text(line) : null));
    view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(paragraphs), 0, 0)).scrollIntoView()); return true;
  }, handleDrop: (_view, event) => { const dropped = [...(event.dataTransfer?.files || [])]; if (!dropped.length) return false; event.preventDefault(); const position = _view.posAtCoords({ left: event.clientX, top: event.clientY }); if (position) editor.commands.setTextSelection(position.pos); dropped.forEach(addAttachment); return true; } }, onUpdate: () => { dirty = editor.getMarkdown() !== original || !active.sha; updateStatus(); }, onSelectionUpdate: updateToolbar });
  // Normalize the trailing paragraph before recording the clean baseline.
  const initialDirty=dirty;editor.view.dispatch(editor.state.tr.setMeta('addToHistory',false));
  original = editor.getMarkdown();dirty=initialDirty;updateToolbar();
}
function updateToolbar() {
  if (!editor) return;
  $('#text-style').value = editor.isActive('heading') ? String(editor.getAttributes('heading').level) : '0';
  document.querySelectorAll('[data-format]').forEach(button => { const on = editor.isActive(button.dataset.format); button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); });
}
function updateStatus() {
  if (!$('#save-state')) return;
  $('#save-state').textContent = busy ? 'Sparar…' : opening ? 'Öppnar fil…' : dirty ? 'Du har osparade ändringar' : active ? 'Alla ändringar är sparade' : 'Föreningens gemensamma material';
  $('#save-state').classList.toggle('unsaved', dirty);
  if ($('#save-doc')) $('#save-doc').disabled = busy || !dirty;
  $('#word-count').textContent = editor ? `${editor.getText().trim().split(/\s+/).filter(Boolean).length} ord` : '';
}
function renderDocBar() {
  const selectedFile = active;
  $('#doc-bar').innerHTML = `<div class="breadcrumb">${icon('file')}<span>${esc(active.path.split('/').slice(0, -1).map(folderLabel).join(' / ') || 'Material')}</span><span>/</span><strong>${esc(titleOf(active.path))}</strong></div><div class="doc-actions">${isExercise(active.path) ? `<button id="add-plan" class="secondary">${icon('plus')} Till träning</button>` : ''}<button id="active-file-menu" class="icon-button" aria-label="Filalternativ">${icon('more')}</button><button id="download-doc" class="icon-button" aria-label="Ladda ner dokument" title="Ladda ner dokument">${icon('download')}</button>${editablePath(active.path) ? '<button id="save-doc" class="primary compact" disabled>Spara ändringar</button>' : ''}</div>`;
  $('#active-file-menu').onclick = () => fileMenu(selectedFile);
  if ($('#add-plan')) $('#add-plan').onclick = addToPlan;
  $('#download-doc').onclick = async () => { if (editor) download(utf8.encode(editor.getMarkdown()), active.path.split('/').pop()); else if (sheet) download(await sheet.getBytes(), active.path.split('/').pop()); else download(await bytesOf(selectedFile), selectedFile.path.split('/').pop()); };
  if ($('#save-doc')) $('#save-doc').onclick = saveDocument;
}
async function addImage(file) {
  if (!editor || busy) return;
  if (file.size > MAX_SIZE) return notice('Bilden får vara högst 5 MB.', true);
  const mime = imageMime(file.name) || (/^image\/(png|jpeg|webp|gif)$/.test(file.type) ? file.type : null);
  if (!mime) return notice('Välj en bild i PNG-, JPG-, WebP- eller GIF-format.', true);
  const target = editor, documentPath = active.path;
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mime];
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (target !== editor || target.isDestroyed) return;
  const path = `bilder/${crypto.randomUUID()}.${extension}`;
  pendingImages.set(path, bytes); imageUrls.set(path, blobUrl(bytes, mime));
  editor.chain().focus().setImage({ src: relativePath(documentPath, path), alt: file.name || 'Bild' }).run();
}
async function addVideo(file){
  if(!editor||busy)return;
  if(file.size>25*1024*1024)return notice('Videoklippet får vara högst 25 MB.',true);
  const mime=videoMime(file.name)||(/^video\/(mp4|webm|quicktime)$/.test(file.type)?file.type:null);
  if(!mime)return notice('Välj ett videoklipp i MP4-, MOV- eller WebM-format.',true);
  const target=editor,documentPath=active.path,extension=({'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'})[mime];
  const bytes=new Uint8Array(await file.arrayBuffer());if(target!==editor||target.isDestroyed)return;
  const path=`filmer/${crypto.randomUUID()}.${extension}`;
  pendingImages.set(path,bytes);imageUrls.set(path,blobUrl(bytes,mime));
  editor.chain().focus().insertContent({type:'video',attrs:{src:relativePath(documentPath,path),alt:file.name||'Videoklipp'}}).run();
}

function addLink() {
  if (!editor) return;
  const current = editor.getAttributes('link').href || '';
  dialog('Lägg till en länk', `<form><label>Webbadress<input name="url" type="url" placeholder="https://…" value="${esc(current)}"></label><p class="muted">Markera gärna texten som ska bli en länk först.</p><div class="dialog-actions"><button type="button" class="secondary" id="remove-link">Ta bort länk</button><button class="primary">Lägg till länk</button></div></form>`, node => {
    node.querySelector('form').onsubmit = event => { event.preventDefault(); const url = node.querySelector('input').value.trim(); if (!/^https?:\/\//i.test(url)) return; editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run(); if (editor.state.selection.empty) editor.commands.insertContent(url); node.close(); };
    node.querySelector('#remove-link').onclick = () => { editor.chain().focus().unsetLink().run(); node.close(); };
  });
}
function newDocument() {
  if (busy || !confirmLeave()) return;
  dialog('Vad vill du skapa?', `<form><label>Namn<input name="name" placeholder="Till exempel: Passningar i rörelse" required maxlength="100"></label><label>Placering<select name="folder"><option value="ovningar">Övningar</option><option value="dokument">Dokument</option></select></label><div class="dialog-actions"><button class="primary">Skapa dokument</button></div></form>`, node => {
    node.querySelector('form').onsubmit = event => {
      event.preventDefault(); const name = node.querySelector('[name=name]').value.trim(); const path = `${node.querySelector('[name=folder]').value}/${slug(name)}.md`;
      if (files.some(f => f.path === path)) return notice('Det namnet används redan. Välj ett annat.', true);
      imageView?.destroy();imageView=null;openController?.abort(); openVersion++; opening = false; $('#document-area').setAttribute('aria-busy','false');
      editor?.destroy(); pendingImages.clear(); active = { path, sha: null, exercise: isExercise(path) }; dirty = true; renderDocBar(); mountEditor(`# ${name}\n\n`); dirty = true; renderTree(); updateStatus(); node.close(); editor.commands.focus('end');
    };
  });
}
function resetDocument() { imageView?.destroy();imageView=null; openController?.abort(); openVersion++; opening = false; sheet?.destroy(); sheet = null; editor?.destroy(); editor = null; active = null; dirty = false; pendingImages.clear(); $('#format-bar').hidden = true; $('#doc-bar').innerHTML = '<span>Välj ett dokument i biblioteket</span>'; $('#document-area').innerHTML = '<div class="empty"><h2>Välj ett dokument till vänster.</h2></div>'; updateStatus(); }
async function saveDocument() {
  if (sheet) { const target = active.path; const changes = [{ path: target, bytes: await sheet.getBytes(), baseSha: active.sha }]; commitDialog(changes, async () => { dirty = false; await reload(target); }); return; }
  const content = editor.getMarkdown(); const changes = [{ path: active.path, bytes: utf8.encode(content), baseSha: active.sha }];
  for (const [path, bytes] of pendingImages) if (content.includes(relativePath(active.path, path))) changes.push({ path, bytes, baseSha: null });
  commitDialog(changes, async () => { const path = active.path; dirty = false; pendingImages.clear(); await reload(path); });
}
async function reload(path) { const client = api; const result = await client.load(); if (client !== api) return; files = result; renderTree(); if (path) { const file = files.find(f => f.path === path); if (file) await openFile(file, true); } }
function commitDialog(changes, after, removing = false) {
  const node = dialog(removing ? 'Ta bort fil' : 'Spara ändringar', `<form><p>${removing ? 'Filen tas bort från det gemensamma materialet när du bekräftar.' : `${changes.length === 1 ? 'Ditt dokument' : `Dina ${changes.length} filer`} sparas i föreningens gemensamma material.`}</p><details class="save-files"><summary>Visa filer som sparas</summary><ul>${changes.map(change => `<li>${esc(change.path)}</li>`).join('')}</ul></details><label>Vad har du ändrat?<textarea name="message" placeholder="Till exempel: Förtydligade instruktionerna och lade till en bild" rows="3" required maxlength="500"></textarea></label><p class="muted">Beskrivningen hjälper oss att följa hur materialet utvecklas.</p><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary cancel-save">Avbryt</button><button type="submit" class="primary">Spara ändringar</button></div></form>`);
  if (removing) { node.querySelector('[type=submit]').textContent = 'Ta bort fil'; node.querySelector('[name=message]').value = `Tar bort ${changes[0].path.split('/').pop()}`; }
  node.querySelector('.cancel-save').onclick = () => node.close();
  node.querySelector('form').onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true; updateStatus(); const submit = node.querySelector('[type=submit]'); submit.disabled = true; submit.textContent = 'Sparar…'; const close = node.querySelector('.close'); close.disabled = true; node.querySelector('.cancel-save').disabled = true;
    const blockClose = event => event.preventDefault(); node.addEventListener('cancel', blockClose);
    editor?.setEditable(false);
    try {
      await api.save(changes, node.querySelector('textarea').value, resolveConflict);
      busy = false; editor?.setEditable(true); node.close(); await after(); notice('Sparat! Materialet är uppdaterat.');
    } catch (error) { node.querySelector('.form-error').textContent = error.message; }
    finally { busy = false; editor?.setEditable(true); submit.disabled = false; submit.textContent = removing ? 'Ta bort fil' : 'Spara ändringar'; close.disabled = false; node.querySelector('.cancel-save').disabled = false; node.removeEventListener('cancel', blockClose); updateStatus(); }
  };
}
function resolveConflict(conflict) {
  return new Promise(resolve => {
    let answered = false;
    const node = dialog('Någon annan har också ändrat', `<p><strong>${esc(titleOf(conflict.path))}</strong> har ändrats sedan du öppnade det. ${conflict.deleted ? 'Den sparade filen har tagits bort.' : 'Välj hur ni vill gå vidare.'}</p>${conflict.markdown ? '<div class="versions"><section><h3>Din version</h3><div id="local-version"></div></section><section><h3>Den sparade versionen</h3><div id="remote-version"></div></section></div><label>Den gemensamma versionen</label><div id="resolved" class="merge-editor"></div><p class="muted">Skriv den version ni vill behålla. Du kan kopiera formuleringar från båda versionerna ovan.</p>' : '<p>Det här är en bilaga. Behåll din fil, eller avbryt och hämta den sparade filen.</p>'}<div class="dialog-actions"><button class="secondary" id="cancel-merge">Avbryt sparning</button><button class="primary" id="resolve-merge">${conflict.markdown ? 'Använd gemensam version' : 'Behåll min fil'}</button></div>`);
    const views = [];
    if (conflict.markdown) {
      node.classList.add('merge-dialog');
      for (const [id, content, editable] of [['local-version', text(conflict.local), false], ['remote-version', text(conflict.remote), false], ['resolved', text(conflict.local), true]]) {
        views.push(new Editor({ element: node.querySelector(`#${id}`), extensions: [StarterKit.configure({ link: { openOnClick: false } }), ...documentMedia(conflict.path), ...richExtensions(), Markdown], content, contentType: 'markdown', editable, editorProps: { attributes: { 'aria-label': id === 'resolved' ? 'Den gemensamma versionen' : id === 'local-version' ? 'Din version' : 'Den sparade versionen' }, handleKeyDown: (_view, event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); views[2].commands.redo(); return true; } return false; } } }));
      }
    }
    node.querySelector('#cancel-merge').onclick = () => node.close();
    node.querySelector('#resolve-merge').onclick = () => { answered = true; resolve(conflict.markdown ? utf8.encode(views[2].getMarkdown()) : conflict.local); node.close(); };
    node.addEventListener('close', () => { views.forEach(view => view.destroy()); if (!answered) resolve(null); });
  });
}

function uploadFiles() {
  if (busy) return;
  const folders = [...new Set(['', 'bilder', 'filmer', 'ovningar', 'dokument', 'traningar', ...(api.current?.directories || []), ...files.map(file => file.path.split('/').slice(0,-1).join('/'))])].sort((a,b)=>a.localeCompare(b,'sv'));
  dialog('Lägg till material', `<form><label>Placering<select name="folder">${folders.map(path => `<option value="${esc(path)}" ${path === (selectedFolder || 'ovningar') ? 'selected' : ''}>${esc(path ? path.split('/').map(folderLabel).join(' / ') : 'Basket')}</option>`).join('')}</select></label><label class="file-pick custom-picker">Välj filer<input type="file" name="files" multiple></label><label class="file-pick custom-picker">Eller välj en hel mapp<input type="file" name="folders" webkitdirectory multiple></label><div id="upload-previews" class="upload-previews" aria-live="polite"></div><p class="muted">Word-filer (.docx) får också en redigerbar dokumentkopia. Mappstrukturen följer med. Högst 200 filer och 50 MB totalt. Videoklipp högst 25 MB, övriga filer 5 MB.</p><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="primary">Fortsätt</button></div></form>`, node => {
    const previews = [];
    node.querySelectorAll('input[type=file]').forEach(input => input.addEventListener('change', () => {
      previews.forEach(URL.revokeObjectURL); previews.length = 0;
      const chosen = [...node.querySelector('[name=files]').files, ...node.querySelector('[name=folders]').files];
      node.querySelector('#upload-previews').innerHTML = chosen.map(file => {
        const url = imageMime(file.name) ? URL.createObjectURL(file) : null; if (url) previews.push(url);
        return `<div class="upload-preview">${url ? `<img src="${url}" alt="Förhandsvisning av ${esc(file.name)}">` : icon('file')}<span>${esc(file.webkitRelativePath || file.name)}</span><small>${Math.ceil(file.size/1024)} KB</small></div>`;
      }).join('');
    }));
    node.querySelector('#upload-previews').addEventListener('error', event => { if (event.target.tagName === 'IMG') { const replacement=document.createElement('span'); replacement.className='preview-unavailable'; replacement.textContent='Bild'; event.target.replaceWith(replacement); } }, true);
    node.addEventListener('close', () => previews.forEach(URL.revokeObjectURL));
    node.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const uploaded = [...node.querySelector('[name=files]').files, ...node.querySelector('[name=folders]').files];
      if (!uploaded.length) { node.querySelector('.form-error').textContent = 'Välj filer eller en mapp först.'; return; }
      const folder = node.querySelector('select').value;
      try { node.close(); await stageUploads(uploaded.map(file => ({ file, path: file.webkitRelativePath || file.name })), folder); }
      catch (error) { notice(error.message, true); }
    };
  });
}

async function addToPlan() {
  if (plan.length >= 6) return notice('Träningen har redan sex övningar. Ta bort en för att lägga till en annan.', true);
  if (dirty || !active.sha) return notice('Spara övningen först, så att träningen använder det gemensamma materialet.', true);
  if (plan.some(e => e.path === active.path)) return notice('Övningen finns redan i träningen.');
  const content = text(await bytesOf(active));
  planDirty = true; plan.push({ path: active.path, title: titleOf(active.path, content), content, minutes: 10 });
  $('#planner').hidden = false; renderPlan(); notice('Övningen är tillagd i träningen.');
}
function renderPlan() {
  if (!$('#planner')) return;
  $('#plan-count').textContent = `${plan.length}/6`;
  const count = plan.length, total = plan.reduce((sum, e) => sum + e.minutes, 0);
  $('#planner').innerHTML = `<div class="planner-heading"><span class="eyebrow">NÄSTA PASS</span><button class="icon-button" id="close-plan" aria-label="Stäng träningspass">${icon('close')}</button></div><h2>Din träning</h2><p class="muted">Välj 4–6 övningar ur materialet.</p><label>Träningens namn<input id="plan-name" placeholder="Till exempel: Tisdagsträning" value="${esc(planTitle)}" maxlength="100"></label><div class="plan-items">${count ? plan.map((entry, i) => `<article class="plan-item"><span class="plan-number">${i + 1}</span><div><strong>${esc(entry.title)}</strong><label class="minutes"><input type="number" min="1" max="180" value="${entry.minutes}" data-minutes="${i}" aria-label="Minuter för ${esc(entry.title)}"> min</label></div><div class="plan-order"><button data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Flytta upp ${esc(entry.title)}">${icon('up')}</button><button data-down="${i}" ${i === count - 1 ? 'disabled' : ''} aria-label="Flytta ner ${esc(entry.title)}">${icon('down')}</button><button data-remove="${i}" aria-label="Ta bort ${esc(entry.title)}">${icon('close')}</button></div></article>`).join('') : '<div class="plan-empty">Öppna en övning och välj<br><strong>+ Till träning</strong></div>'}</div><label>Att tänka på<textarea id="plan-notes" rows="3" placeholder="Grupp, fokus eller något att förbereda…">${esc(planNotes)}</textarea></label><div class="plan-total"><span>${count} av 4–6 övningar</span><strong id="plan-total">${total} min</strong></div><button id="save-plan" class="primary" ${count < 4 ? 'disabled' : ''}>Spara träning</button><button id="export-plan" class="secondary" ${count < 4 ? 'disabled' : ''}>${icon('download')} Ladda ner träning</button>`;
  $('#close-plan').onclick = () => { $('#planner').hidden = true; };
  $('#plan-name').oninput = e => { planTitle = e.target.value; planDirty = true; }; $('#plan-notes').oninput = e => { planNotes = e.target.value; planDirty = true; };
  $('#planner').querySelectorAll('[data-minutes]').forEach(input => input.onchange = () => { planDirty = true; plan[Number(input.dataset.minutes)].minutes = Math.max(1, Math.min(180, Number(input.value) || 10)); input.value = plan[Number(input.dataset.minutes)].minutes; $('#plan-total').textContent = `${plan.reduce((sum, e) => sum + e.minutes, 0)} min`; });
  $('#planner').querySelectorAll('[data-remove]').forEach(button => button.onclick = () => { planDirty = true; plan.splice(Number(button.dataset.remove), 1); renderPlan(); });
  for (const direction of ['up', 'down']) $('#planner').querySelectorAll(`[data-${direction}]`).forEach(button => button.onclick = () => { const i = Number(button.dataset[direction]), j = i + (direction === 'up' ? -1 : 1); planDirty = true; [plan[i], plan[j]] = [plan[j], plan[i]]; renderPlan(); });
  $('#export-plan').onclick = () => { try { download(utf8.encode(trainingMarkdown(planTitle, planNotes, plan)), `${slug(planTitle || 'traningspass')}.md`); } catch (error) { notice(error.message, true); } };
  $('#save-plan').onclick = () => {
    if (busy || !confirmLeave()) return;
    const name = planTitle.trim() || 'Träningspass'; const path = `traningar/${slug(name)}.md`;
    if (files.some(f => f.path === path) && !confirm('En träning med det namnet finns redan. Vill du uppdatera den?')) return;
    try { const content = trainingMarkdown(name, planNotes, plan); commitDialog([{ path, bytes: utf8.encode(content), baseSha: files.find(f => f.path === path)?.sha || null }], async () => { dirty = false; planDirty = false; await reload(path); }); } catch (error) { notice(error.message, true); }
  };
}
function download(bytes, name) { const url = blobUrl(bytes, 'application/octet-stream'); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => { URL.revokeObjectURL(url); objectUrls.delete(url); }, 1000); }
window.addEventListener('beforeunload', event => { if (dirty || planDirty || busy) { event.preventDefault(); event.returnValue = ''; } });
start();

function renderRecents() {
  if (!$('#recents')) return;
  $('#recents').innerHTML = recents.map(path => `<button class="recent-file" data-recent="${esc(path)}">${icon('file')}<span>${esc(titleOf(path))}</span></button>`).join('') || '<p class="muted">Dina senaste filer visas här.</p>';
  $('#recents').querySelectorAll('button').forEach(button => button.onclick = () => { const file = files.find(f => f.path === button.dataset.recent); if (file) openFile(file); });
}
function cacheCopy(view, event) {
  if (view.state.selection.empty || !event.clipboardData) return false;
  const slice = view.state.selection.content();
  const plain = slice.content.textBetween(0, slice.content.size, '\n');
  const id = crypto.randomUUID();
  clipboardCache = { id, path: active.path, slice, markdown: editor.markdown.serialize(slice.content.toJSON()) };
  event.clipboardData.setData('text/plain', plain);
  event.clipboardData.setData('application/x-knivsta-selection', id);
  event.preventDefault(); return true;
}
async function addAttachment(file) {
  if (imageMime(file.name) || /^image\/(png|jpeg|webp|gif)$/.test(file.type)) return addImage(file);
  if(videoMime(file.name)||/^video\/(mp4|webm|quicktime)$/.test(file.type))return addVideo(file);
  if (!editor || busy) return;
  if (file.size > MAX_SIZE) return notice('Filen får vara högst 5 MB.', true);
  const target = editor, documentPath = active.path;
  const safeName = file.name.replace(/[^a-zA-Z0-9åäöÅÄÖ._-]/g, '-').replace(/^\.+/, '') || 'bilaga';
  const path = `bilagor/${crypto.randomUUID()}-${safeName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (target !== editor || target.isDestroyed) return;
  pendingImages.set(path, bytes);
  editor.chain().focus().insertContent({ type: 'text', text: file.name || 'Bilaga', marks: [{ type: 'link', attrs: { href: relativePath(documentPath, path), target: null } }] }).run();
  notice('Bilagan läggs till när du sparar dokumentet.');
}
async function openLink(href) {
  if (/^https?:\/\//i.test(href)) { window.open(href, '_blank', 'noopener,noreferrer'); return; }
  const path = resolvePath(active.path, href), file = files.find(f => f.path === path);
  if (!file) { notice('Spara dokumentet för att kunna öppna den nya bilagan.'); return; }
  if (isMarkdown(path)) return openFile(file);
  try { download(await bytesOf(file), path.split('/').pop()); } catch (error) { notice(error.message, true); }
}

function setupTreeTransfers() {
  const tree = $('#tree');
  tree.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; tree.classList.add('drop-target'); } });
  tree.addEventListener('dragleave', event => { if (!tree.contains(event.relatedTarget)) tree.classList.remove('drop-target'); });
  tree.addEventListener('drop', async event => {
    event.preventDefault(); event.stopPropagation(); tree.classList.remove('drop-target'); if (busy) return;
    const destination = event.target.closest('[data-folder]')?.dataset.folder ?? '';
    const entries = [...event.dataTransfer.items].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.());
    const fallback = [...event.dataTransfer.files];
    try {
      const uploads = entries.some(Boolean) ? (await Promise.all(entries.filter(Boolean).map(entry => walkEntry(entry)))).flat() : fallback.map(file => ({ file, path: file.name }));
      await stageUploads(uploads, destination);
    } catch (error) { notice(error.message, true); }
  });
  tree.addEventListener('paste', async event => {
    const pasted = [...(event.clipboardData?.files || [])]; if (!pasted.length || busy) return;
    event.preventDefault(); event.stopPropagation();
    try { await stageUploads(pasted.map(file => ({ file, path: file.name })), selectedFolder); } catch (error) { notice(error.message, true); }
  });
}
async function walkEntry(entry, parent = '', result = []) {
  const path = `${parent}${entry.name}`;
  if (entry.isFile) {
    if (result.length >= 200) throw new Error('Välj högst 200 filer åt gången.');
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    result.push({ file, path }); return result;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    while (true) {
      const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!children.length) break;
      for (const child of children) await walkEntry(child, `${path}/`, result);
    }
  }
  return result;
}
async function stageUploads(uploads, folder = '') {
  if (busy) return;
  const client = api;
  if (!uploads.length) throw new Error('Mappen innehåller inga filer. Tomma mappar sparas inte.');
  if (uploads.length > 200 || uploads.some(({ file }) => file.size > fileLimit(file.name)) || uploads.reduce((sum, { file }) => sum + file.size, 0) > 50 * 1024 * 1024) throw new Error('Välj högst 200 filer och 50 MB totalt. Videoklipp får vara högst 25 MB och övriga filer 5 MB.');
  const paths = uploads.map(({ path }) => `${folder ? `${folder}/` : ''}${path}`);
  if (paths.some(path => !validPath(path)) || new Set(paths).size !== paths.length) throw new Error('Någon fil har ett ogiltigt eller dubblerat namn. Dolda filer stöds inte.');
  const replaced = paths.filter(path => files.some(file => file.path === path));
  if (replaced.length && !confirm(`Dessa filer finns redan och ersätts när du sparar:\n${replaced.slice(0, 10).join('\n')}${replaced.length > 10 ? '\n…' : ''}\n\nVill du fortsätta?`)) return;
  let changes = await Promise.all(uploads.map(async ({ file }, i) => ({ path: paths[i], bytes: new Uint8Array(await file.arrayBuffer()), baseSha: files.find(existing => existing.path === paths[i])?.sha || null })));
  const words = changes.filter(change => /\.docx$/i.test(change.path));
  if (words.length) {
    notice('Gör Word-filerna till redigerbara dokument…');
    const { convertWord } = await import('./word.js');
    for (const word of words) {
      const converted = await convertWord(word.bytes, word.path);
      if (changes.some(change => change.path === converted.path)) throw new Error('Uppladdningen innehåller redan ett dokument med samma namn som Word-kopian. Välj ett annat namn.');
      const existing = files.find(file => file.path === converted.path);
      if (existing && !confirm(`Dokumentet ${converted.path} finns redan. Vill du ersätta det med Word-kopian?`)) return;
      changes.push({ path: converted.path, bytes: converted.bytes, baseSha: existing?.sha || null }, ...converted.images);
      if (converted.warnings.length) notice('Word-filen är konverterad. Vissa Word-detaljer kan ha förenklats. Originalfilen sparas också.');
    }
  }
  if (client !== api) return;
  commitDialog(changes, async () => { await reload(); });
}
async function downloadFolder(folder) {
  const client = api;
  const inside = files.filter(file => !folder || file.path.startsWith(`${folder}/`));
  if (!inside.length) return notice('Mappen är tom.');
  if (inside.some(f => f.size > fileLimit(f.path)) || inside.reduce((sum, f) => sum + f.size, 0) > 50 * 1024 * 1024) return notice('Mappen är för stor för att laddas ner här. Välj en mindre undermapp.', true);
  notice('Förbereder mappen för nedladdning…');
  try {
    const zipped = {};
    for (const file of inside) zipped[file.path.slice(folder ? folder.length + 1 : 0)] = await bytesOf(file);
    if (client !== api) return;
    download(zipSync(zipped), `${folder ? folder.split('/').pop() : 'Basket'}.zip`);
    notice('Mappen är klar för nedladdning.');
  } catch (error) { notice(error.message, true); }
}

function colorPalette() {
  const colors = [['Standard',''],['Röd','#c84d4d'],['Orange','#bb681e'],['Grön','#35825a'],['Blå','#397bb8'],['Lila','#8a60bc']];
  dialog('Välj textfärg', `<p>Markera text och välj en färg.</p><div class="color-palette">${colors.map(([name,color])=>`<button class="color-choice" data-color="${color}" aria-label="${name}"><span style="background:${color||'var(--ink)'}"></span>${name}</button>`).join('')}</div>`, node => {
    node.querySelectorAll('[data-color]').forEach(button => button.onclick = () => { const color = button.dataset.color; color ? editor.chain().focus().setColor(color).run() : editor.chain().focus().unsetColor().run(); node.close(); });
  });
}

function setLibraryOpen(open) {
  if (!$('.workspace')) return;
  if (matchMedia('(orientation:landscape)').matches) open=false;
  delete $('.workspace').dataset.gestureOwner;
  $('.workspace').classList.toggle('library-open', open);
  $('#library-backdrop').hidden = !open;
  $('#mobile-files').setAttribute('aria-expanded', String(open));
}
function setupSwipes() {
  const workspace=$('.workspace'),panel=$('.sidebar'),backdrop=$('#library-backdrop');let drag;
  const portrait=()=>matchMedia('(max-width:760px) and (orientation:portrait)').matches;
  const ownsNavigation=(x)=>portrait()&&(workspace.classList.contains('library-open')||x<=28||x>=innerWidth-28);
  // Capture ownership before the target's image/pointer handlers can run.
  workspace.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'&&ownsNavigation(event.clientX))workspace.dataset.gestureOwner='drawer';},{capture:true,passive:true});
  for(const name of ['pointerup','pointercancel'])workspace.addEventListener(name,()=>{if(!drag)delete workspace.dataset.gestureOwner;},{capture:true,passive:true});
  function finish(cancel=false){
    if(!drag){delete workspace.dataset.gestureOwner;return;}
    const dx=drag.dx||0,target=cancel?drag.open:Math.abs(dx)>20?dx>0:drag.open;
    workspace.classList.remove('drawer-dragging');panel.style.transform='';backdrop.style.opacity='';drag=null;delete workspace.dataset.gestureOwner;setLibraryOpen(target);
  }
  workspace.addEventListener('touchstart',event=>{
    if(!portrait()||event.touches.length!==1){finish(true);return;}
    const touch=event.touches[0],isOpen=workspace.classList.contains('library-open');
    if(!isOpen&&touch.clientX>28)return;
    // An open panel can be closed from anywhere, including its file buttons.
    workspace.dataset.gestureOwner='drawer';
    const bounds=panel.getBoundingClientRect();
    drag={x:touch.clientX,y:touch.clientY,dx:0,open:isOpen,width:bounds.width,progress:Math.max(0,Math.min(1,(bounds.x+bounds.width)/bounds.width)),started:false};
  },{capture:true,passive:true});
  workspace.addEventListener('touchmove',event=>{
    if(!drag||event.touches.length!==1){finish(true);return;}
    const touch=event.touches[0],dx=touch.clientX-drag.x,dy=touch.clientY-drag.y;
    if(!drag.started){if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){drag=null;delete workspace.dataset.gestureOwner;return;}if(Math.abs(dx)<6)return;drag.started=true;workspace.classList.add('drawer-dragging');workspace.dispatchEvent(new Event('drawerdragstart'));}
    if(event.cancelable)event.preventDefault();event.stopPropagation();
    drag.dx=dx;const progress=Math.max(0,Math.min(1,drag.progress+dx/drag.width));
    panel.style.transform=`translateX(${(progress-1)*drag.width}px)`;backdrop.hidden=false;backdrop.style.opacity=String(progress);
  },{capture:true,passive:false});
  workspace.addEventListener('touchend',event=>{if(drag&&event.changedTouches.length)drag.dx=event.changedTouches[0].clientX-drag.x;finish();},{capture:true,passive:true});workspace.addEventListener('touchcancel',()=>finish(),{capture:true,passive:true});
  const orientation=matchMedia('(orientation:landscape)');orientation.addEventListener('change',()=>{finish(true);if(orientation.matches)setLibraryOpen(false);});
}

function fileMenu(file) {
  if (!file || busy) return;
  dialog(file.path.split('/').pop(), '<div class="file-actions"><button class="secondary" id="menu-download">Ladda ner</button><button class="secondary danger" id="menu-delete">Ta bort fil</button></div>', node => {
    node.querySelector('#menu-download').onclick = async () => { node.close(); try { download(await bytesOf(file),file.path.split('/').pop()); } catch(error) { notice(error.message,true); } };
    node.querySelector('#menu-delete').onclick = () => { node.close(); if(active?.path===file.path&&!confirmLeave())return; commitDialog([{path:file.path,baseSha:file.sha,delete:true}],async()=>{ if(active?.path===file.path)resetDocument();recents=recents.filter(path=>path!==file.path);await reload();renderRecents(); },true); };
  });
}
function setupFileMenus() {
  const tree=$('#tree');let timer,start;
  const cancel=()=>{clearTimeout(timer);timer=null;};
  $('.workspace').addEventListener('drawerdragstart',cancel);
  tree.addEventListener('contextmenu',event=>{const row=event.target.closest('[data-file-row]');if(!row)return;event.preventDefault();cancel();suppressFileClickUntil=Date.now()+800;fileMenu(files.find(file=>file.path===row.dataset.fileRow));});
  tree.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch'||!event.target.closest('[data-file-row]'))return;const path=event.target.closest('[data-file-row]').dataset.fileRow;start={x:event.clientX,y:event.clientY};timer=setTimeout(()=>{suppressFileClickUntil=Date.now()+1000;fileMenu(files.find(file=>file.path===path));},550);});
  tree.addEventListener('pointermove',event=>{if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>10)cancel();});
  for(const name of ['pointerup','pointercancel','scroll'])tree.addEventListener(name,cancel);
}

function persistLibrary(){if(api?.current)void writeLibraryCache({branch:api.branch,current:api.current,lastPath:active?.path||null});}
async function enterWorkspace(client,result,name,lastPath=null){
  displayName=name;api=client;files=result;workspace();
  const first=files.find(file=>file.path===lastPath)||files.find(file=>/Valkommen\.md$/.test(file.path))||files.find(file=>isMarkdown(file.path))||files[0];
  if(first)await openFile(first);else persistLibrary();
}
async function syncSession(client,session,alreadyFresh=false){
  try{
    if(!await verifySession(session)){if(api!==client)return;await forgetSession();await clearContentCache();clearPrivate();login();$('#login-error').textContent='Tillgången har ändrats. Logga in igen.';return;}
    if(alreadyFresh)return;
    const result=await client.load();if(api!==client)return;files=result;renderTree();persistLibrary();
    if(active&&!dirty&&!opening){const latest=files.find(file=>file.path===active.path);if(!latest)resetDocument();else if(latest.sha!==active.sha)await openFile(latest,true);}
  }catch(error){if(api!==client)return;if([401,403,404].includes(error.status)){await forgetSession();await clearContentCache();clearPrivate();login();$('#login-error').textContent='Åtkomsten behöver förnyas. Logga in igen eller kontakta ansvarig.';}else{notice('Visar sparat material. Det gick inte att kontrollera uppdateringar just nu.');}}
}
async function start(){
  $('#app').innerHTML='<div class="restoring-login" role="status"><span class="loading-spinner" aria-hidden="true"></span>Öppnar materialet…</div>';
  try{
    const saved=await restoreSession();if(!saved){login();return;}
    configureContentCache(saved);const client=new GitHub(saved.token,saved.name);const library=await readLibraryCache();
    if(library?.current?.files){client.branch=library.branch;client.current=library.current;await enterWorkspace(client,library.current.files,saved.name,library.lastPath);void syncSession(client,saved);}
    else{const result=await client.load();await enterWorkspace(client,result,saved.name);void syncSession(client,saved,true);}
  }catch(error){
    if([401,403,404].includes(error.status)){try{await forgetSession();await clearContentCache();}catch{}}
    login();$('#login-error').textContent=error.status?'Åtkomsten behöver förnyas. Logga in igen eller kontakta ansvarig.':'Det gick inte att öppna materialet. Kontrollera anslutningen och försök igen.';
    const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Försök igen';retry.onclick=start;$('#login-form').append(retry);
  }
}
