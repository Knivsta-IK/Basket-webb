import DOMPurify from 'dompurify';
const unsafeCss=value=>/@import/i.test(value)||[...value.matchAll(/url\(([^)]*)\)/gi)].some(match=>!match[1].trim().replace(/^['"]|['"]$/g,'').startsWith('#'));
export function cleanSvg(bytes){
  const safe=DOMPurify.sanitize(new TextDecoder().decode(bytes),{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','script','iframe','object','embed']});
  const doc=new DOMParser().parseFromString(safe,'image/svg+xml');
  if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw new Error('SVG-filen kunde inte läsas.');
  for(const el of doc.querySelectorAll('*')){
    for(const attribute of [...el.attributes]){
      const value=attribute.value.trim();
      if((attribute.localName==='href'&&!value.startsWith('#')&&!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value))||unsafeCss(value))el.removeAttributeNode(attribute);
    }
    if(el.localName==='style'&&unsafeCss(el.textContent))el.remove();
  }
  return new TextEncoder().encode(new XMLSerializer().serializeToString(doc));
}
