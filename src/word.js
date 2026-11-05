import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';
import DOMPurify from 'dompurify';
import { richExtensions } from './rich-text.js';
import { unzipSync, strFromU8 } from 'fflate';
import { decode, utf8 } from './github.js';

export async function convertWord(bytes, path) {
  if(/\.doc$/i.test(path)){
    const {legacyWordText}=await import('./legacy-word.js');const content=await legacyWordText(bytes);
    const escaped=content.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    return fromHtml(escaped.split(/\n+/).map(line=>`<p>${line}</p>`).join(''),path,[],['Äldre DOC importeras som text. Bilder, tabeller och formatering behöver återskapas.','Kommentarer och spårade ändringar kan inte tolkas säkert i äldre DOC. Kontrollera texten eller godkänn ändringarna i Word först.']);
  }
  const warnings=['Sidlayout, teckensnitt, sidbrytningar och sidnummer kan förenklas.'];
  let xml='';const selected=unzipSync(bytes,{filter:entry=>{if(/word\/(header|footer)/.test(entry.name))warnings.push('Sidhuvud eller sidfot finns och kan saknas i Markdown.');if(/word\/charts\//.test(entry.name))warnings.push('Diagram finns och kan behöva läggas in som bilder.');if(entry.name==='word/document.xml'){if(entry.originalSize>20*1024*1024)throw new Error('Word-dokumentet är för stort efter uppackning.');return true;}return false;}});
  xml=selected['word/document.xml']?strFromU8(selected['word/document.xml']):'';
  for(const [pattern,message]of [[/<w:(txbxContent|pict)\b/,'Textrutor eller flytande objekt finns och kan hamna i annan ordning.'],[/<w:(ins|del|commentRangeStart)\b/,'Spårade ändringar eller kommentarer finns. Kontrollera vilken text som följer med.'],[/<w:cols\b[^>]*w:num="[2-9]/,'Flera spalter blir ett löpande dokument.'],[/<w:(vMerge|gridSpan)\b/,'Tabeller med sammanslagna celler kan behöva justeras.'],[/<m:oMath\b/,'Matematiska formler kan behöva återskapas.'],[/<w:(footnoteReference|endnoteReference)\b/,'Fotnoter och slutnoter kan få annan placering.']])if(pattern.test(xml))warnings.push(message);
  const { default: mammoth } = await import('mammoth/mammoth.browser.js');
  const images = [];
  const directory = path.split('/').slice(0, -1);
  const relative = '../'.repeat(directory.length);
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, {
    styleMap: ['u => u'],
    convertImage: mammoth.images.imgElement(async image => {
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[image.contentType];
      if (!ext) {warnings.push('En bild har ett format som inte stöds. Spara den som PNG eller JPG och infoga den separat.');return { src: '', alt: 'Bildformatet stöds inte' };}
      const imagePath = `bilder/${crypto.randomUUID()}.${ext}`;
      images.push({ path: imagePath, bytes: decode(await image.read('base64')), baseSha: null });
      return { src: `${relative}${imagePath}` };
    }),
  });
  if(result.messages.length)warnings.push('Vissa Word-element kunde inte överföras. Kontrollera förhandsvisningen.');
  return fromHtml(result.value,path,images,warnings);
}
function fromHtml(html,path,images,warnings){
  // Keep source image paths in Markdown, without requesting private assets during conversion.
  const SafeImage = Image.extend({ addAttributes() { const attrs = this.parent(); return { ...attrs, src: { ...attrs.src, renderHTML: () => ({ src: '' }) } }; } });
  const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, SafeImage, ...richExtensions(), Markdown], content: DOMPurify.sanitize(html) });
  let markdown;
  try { markdown = editor.getMarkdown(); } finally { editor.destroy(); }
  return { path: path.replace(/\.docx?$/i, '.md'), bytes: utf8.encode(markdown), images, warnings:[...new Set(warnings)] };
}
