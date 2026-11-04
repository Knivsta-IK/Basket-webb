import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';
import DOMPurify from 'dompurify';
import { richExtensions } from './rich-text.js';
import { decode, utf8 } from './github.js';

export async function convertWord(bytes, path) {
  const { default: mammoth } = await import('mammoth/mammoth.browser.js');
  const images = [];
  const directory = path.split('/').slice(0, -1);
  const relative = '../'.repeat(directory.length);
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, {
    styleMap: ['u => u'],
    convertImage: mammoth.images.imgElement(async image => {
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[image.contentType];
      if (!ext) return { src: '', alt: 'Bildformatet stöds inte' };
      const imagePath = `bilder/${crypto.randomUUID()}.${ext}`;
      images.push({ path: imagePath, bytes: decode(await image.read('base64')), baseSha: null });
      return { src: `${relative}${imagePath}` };
    }),
  });
  // Keep source image paths in Markdown, without requesting private assets during conversion.
  const SafeImage = Image.extend({ addAttributes() { const attrs = this.parent(); return { ...attrs, src: { ...attrs.src, renderHTML: () => ({ src: '' }) } }; } });
  const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, SafeImage, ...richExtensions(), Markdown], content: DOMPurify.sanitize(result.value) });
  let markdown;
  try { markdown = editor.getMarkdown(); } finally { editor.destroy(); }
  return { path: path.replace(/\.docx$/i, '.md'), bytes: utf8.encode(markdown), images, warnings: result.messages.map(m => m.message) };
}
