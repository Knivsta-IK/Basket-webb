import { Node } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { closeHistory } from '@tiptap/pm/history';

const escapeAttribute=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dimension=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?Math.max(1,Math.min(4096,Math.round(n))):null;};
const attrsOf=html=>{const template=document.createElement('template');template.innerHTML=html;const el=template.content.firstElementChild;return el?{src:el.getAttribute('src')||'',alt:el.getAttribute('alt')||el.getAttribute('title')||'',width:dimension(el.getAttribute('width')),height:dimension(el.getAttribute('height'))}:null;};
const tagPattern=tag=>new RegExp(`^<${tag}\\b(?:[^"'<>]|"[^"]*"|'[^']*')*\\/?>${tag==='video'?'[\\s\\S]*?<\\/video\\s*>':''}`,'i');
function markdownToken(tag,type){return{name:type,level:'block',start:source=>source.search(new RegExp(`<${tag}\\b`,'i')),tokenize(source){const match=tagPattern(tag).exec(source);if(!match)return;const attrs=attrsOf(match[0]);if(!attrs?.src)return;return{type,raw:match[0],href:attrs.src,text:attrs.alt,width:attrs.width,height:attrs.height};}};}
function mediaMarkdown(tag,attrs){const size=`${dimension(attrs.width)?` width="${dimension(attrs.width)}"`:''}${dimension(attrs.height)?` height="${dimension(attrs.height)}"`:''}`;return tag==='video'?`<video src="${escapeAttribute(attrs.src)}"${size} title="${escapeAttribute(attrs.alt)}" controls playsinline></video>`:`<img src="${escapeAttribute(attrs.src)}" alt="${escapeAttribute(attrs.alt)}"${size}>`;}
export function createMediaExtensions({getSource=()=>'',loadSource=async()=>'',onError=()=>{}}={}){
  const shared={getSource,loadSource,onError};
  const Picture=Image.extend({
    draggable:false,
    addAttributes(){return{...this.parent(),src:{default:null,parseHTML:el=>el.getAttribute('src'),renderHTML:attrs=>({src:getSource(attrs.src)||''})},width:{default:null,parseHTML:el=>dimension(el.getAttribute('width'))},height:{default:null,parseHTML:el=>dimension(el.getAttribute('height'))}};},
    parseMarkdown(token,helpers){return helpers.createNode('image',{src:token.href,alt:token.text||'',title:token.title||null,width:dimension(token.width),height:dimension(token.height)});},
    markdownTokenizer:markdownToken('img','image'),
    renderMarkdown(node){if(node.attrs.width||node.attrs.height)return mediaMarkdown('img',node.attrs);const alt=String(node.attrs.alt||'').replace(/[\[\]]/g,'');return `![${alt}](${node.attrs.src}${node.attrs.title?` "${String(node.attrs.title).replace(/"/g,'')}"`:''})`;},
    addNodeView(){return props=>mediaNodeView({...props,...shared,kind:'image'});},
  });
  const Video=Node.create({
    name:'video',group:'block',atom:true,selectable:true,draggable:false,
    addAttributes(){return{src:{default:null,parseHTML:el=>el.getAttribute('src'),renderHTML:attrs=>({src:getSource(attrs.src)||''})},alt:{default:'',parseHTML:el=>el.getAttribute('title')||''},width:{default:null,parseHTML:el=>dimension(el.getAttribute('width'))},height:{default:null,parseHTML:el=>dimension(el.getAttribute('height'))}};},
    parseHTML(){return[{tag:'video[src]'}];},
    renderHTML({HTMLAttributes}){return['video',{...HTMLAttributes,controls:'',playsinline:''}];},
    markdownTokenizer:markdownToken('video','video'),
    parseMarkdown(token,helpers){return helpers.createNode('video',{src:token.href,alt:token.text||'',width:dimension(token.width),height:dimension(token.height)});},
    renderMarkdown(node){return mediaMarkdown('video',node.attrs);},
    addNodeView(){return props=>mediaNodeView({...props,...shared,kind:'video'});},
  });
  return[Picture,Video];
}
function clock(seconds){if(!Number.isFinite(seconds))return'0:00.000';const minutes=Math.floor(seconds/60),rest=(seconds%60).toFixed(3).padStart(6,'0');return`${minutes}:${rest}`;}
export function mediaNodeView({node,editor,getPos,getSource,loadSource,onError=()=>{},kind,standalone=false}){
  let current=node,selected=false,loading=false,destroyed=false,resizing=false,scrubbing=false,ratio=kind==='video'?16/9:3/2,sourceVersion=0;
  const abort=new AbortController(),events={signal:abort.signal};let sourceAbort=new AbortController();
  const dom=document.createElement('div');dom.className=`document-media document-${kind}`;dom.contentEditable='false';
  const frame=document.createElement('div');frame.className='media-frame';
  const media=document.createElement(kind==='video'?'video':'img');media.draggable=false;media.className='document-media-element';
  const placeholder=document.createElement('div');placeholder.className='media-placeholder';placeholder.textContent=kind==='video'?'▶ Tryck för att öppna videon':'Laddar bild…';
  const message=document.createElement('div');message.className='media-message';message.setAttribute('role','status');
  frame.append(media,placeholder);dom.append(frame);let controls,play,slider,time;
  if(kind==='video'){
    media.playsInline=true;media.preload='metadata';
    controls=document.createElement('div');controls.className='document-video-controls';controls.hidden=true;
    play=document.createElement('button');play.type='button';play.className='secondary';play.textContent='Spela';play.setAttribute('aria-label','Spela video');play.disabled=true;
    slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='0';slider.step='0.001';slider.value='0';slider.disabled=true;slider.setAttribute('aria-label','Sök i videon');
    time=document.createElement('span');time.className='video-time';time.textContent='0:00.000 / 0:00.000';
    controls.append(play,slider,time);dom.append(controls);
    play.addEventListener('click',()=>{select();if(media.paused){const result=media.play();result?.catch(()=>{message.textContent='Klippet kunde inte spelas. Kontrollera att formatet stöds av webbläsaren.';});}else media.pause();},events);
    const updatePlayback=()=>{play.textContent=media.paused?'Spela':'Pausa';play.setAttribute('aria-label',media.paused?'Spela video':'Pausa video');const duration=Number.isFinite(media.duration)?media.duration:0;slider.max=String(duration);slider.disabled=duration<=0;play.disabled=media.readyState<1;if(!scrubbing)slider.value=String(media.currentTime||0);time.textContent=`${clock(scrubbing?Number(slider.value):media.currentTime)} / ${clock(duration)}`;};
    for(const name of ['play','pause','ended','loadedmetadata','durationchange','timeupdate','seeked'])media.addEventListener(name,updatePlayback,events);
    slider.addEventListener('input',()=>{scrubbing=true;media.pause();if(Number.isFinite(media.duration)&&media.duration>0)media.currentTime=Math.min(media.duration,Math.max(0,Number(slider.value)));updatePlayback();},events);
    slider.addEventListener('change',()=>{scrubbing=false;updatePlayback();},events);
  }
  dom.append(message);
  const handles=[];
  for(const corner of ['nw','ne','sw','se']){const handle=document.createElement('button');handle.type='button';handle.className=`media-resize-handle handle-${corner}`;handle.setAttribute('aria-label',`Ändra storlek ${ {nw:'övre vänster',ne:'övre höger',sw:'nedre vänster',se:'nedre höger'}[corner] }`);handle.hidden=true;frame.append(handle);handles.push(handle);handle.addEventListener('pointerdown',event=>beginResize(event,corner,handle),events);}
  function updateSelection(value){selected=value;dom.classList.toggle('media-selected',value);for(const handle of handles)handle.hidden=!value||!editor?.isEditable||standalone;if(controls)controls.hidden=!value;}
  function select(){if(editor&&typeof getPos?.()==='number'&&!editor.isDestroyed)editor.commands.setNodeSelection(getPos());updateSelection(true);if(kind==='video')void ensureSource();}
  frame.addEventListener('pointerdown',event=>{if(event.target.closest('.media-resize-handle'))return;select();},events);
  frame.addEventListener('click',select,events);
  function available(){return Math.max(60,editor?.view?.dom.clientWidth||dom.parentElement?.clientWidth||480);}
  function layout(){if(resizing)return;let width=dimension(current.attrs.width)||Math.min(media.naturalWidth||media.videoWidth||480,available());if(standalone&&dom.parentElement?.clientHeight){width=Math.min(width,Math.max(80,(dom.parentElement.clientHeight-90)*ratio));}frame.style.width=`${width}px`;frame.style.aspectRatio=current.attrs.width&&current.attrs.height?`${current.attrs.width} / ${current.attrs.height}`:String(ratio);if(controls)controls.style.width=`${Math.max(240,width)}px`;}
  function metadata(){placeholder.hidden=true;media.classList.add('media-ready');const w=media.naturalWidth||media.videoWidth,h=media.naturalHeight||media.videoHeight;if(w&&h)ratio=w/h;layout();message.textContent='';}
  media.addEventListener(kind==='video'?'loadedmetadata':'load',metadata,events);
  media.addEventListener('error',()=>{placeholder.hidden=false;placeholder.textContent=kind==='video'?'Klippet kan inte visas i den här webbläsaren.':'Bilden kunde inte visas.';if(play)play.disabled=true;},events);
  async function ensureSource(){if(loading||destroyed)return;const ready=getSource(current.attrs.src);if(ready){if(media.getAttribute('src')!==ready)media.src=ready;return;}loading=true;placeholder.hidden=false;placeholder.textContent=kind==='video'?'Förbereder video…':'Laddar bild…';const version=++sourceVersion;try{const src=await loadSource(current.attrs.src,sourceAbort.signal);if(destroyed||sourceAbort.signal.aborted||version!==sourceVersion)return;if(!src)throw new Error('Filen finns inte i materialet.');media.src=src;}catch(error){if(error.name!=='AbortError'&&!destroyed){placeholder.textContent=kind==='video'?'Videon kunde inte hämtas. Tryck för att försöka igen.':'Bilden kunde inte hämtas.';message.textContent=error.message;}}finally{if(version===sourceVersion)loading=false;}}
  function beginResize(event,corner,handle){
    if(!editor?.isEditable||standalone||event.button>0)return;event.preventDefault();event.stopPropagation();select();const bounds=frame.getBoundingClientRect(),startX=event.clientX,startY=event.clientY,startW=bounds.width,startH=bounds.height,aspect=startW/Math.max(1,startH),max=available(),pointer=event.pointerId;let width=startW,height=startH;
    resizing=true;dom.classList.add('media-resizing');try{handle.setPointerCapture(pointer);}catch{}
    const moved=e=>{if(e.pointerId!==pointer)return;e.preventDefault();const dx=(e.clientX-startX)*(corner.includes('w')?-1:1),dy=(e.clientY-startY)*(corner.includes('n')?-1:1),delta=Math.abs(dx/startW)>=Math.abs(dy/startH)?dx:dy*aspect;width=Math.round(Math.max(Math.min(80,max),Math.min(max,startW+delta)));height=Math.round(width/aspect);frame.style.width=`${width}px`;frame.style.aspectRatio=`${width} / ${height}`;if(controls)controls.style.width=`${Math.max(240,width)}px`;};
    const finish=(e,commit=true)=>{if(e.pointerId!==pointer)return;window.removeEventListener('pointermove',moved);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);resizing=false;dom.classList.remove('media-resizing');if(commit&&!destroyed&&!editor.isDestroyed&&typeof getPos?.()==='number'&&(width!==Math.round(startW)||height!==Math.round(startH))){const pos=getPos(),existing=editor.state.doc.nodeAt(pos);if(existing?.type===current.type)editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(pos,undefined,{...current.attrs,width,height}));}layout();};
    const cancel=e=>{if(e.pointerId!==pointer)return;finish(e,false);};
    window.addEventListener('pointermove',moved,{passive:false,signal:abort.signal});window.addEventListener('pointerup',finish,events);window.addEventListener('pointercancel',cancel,events);
  }
  function sync(){media.alt=current.attrs.alt||'';if(kind==='video')media.title=current.attrs.alt||'';layout();const ready=getSource(current.attrs.src);if(ready){if(media.getAttribute('src')!==ready)media.src=ready;}else if(kind==='image'||selected)void ensureSource();}
  sync();
  return {dom,selectNode(){updateSelection(true);if(kind==='video')void ensureSource();},deselectNode(){updateSelection(false);},update(next){if(next.type!==current.type)return false;const changed=next.attrs.src!==current.attrs.src;current=next;if(changed){sourceAbort.abort();sourceAbort=new AbortController();sourceVersion++;loading=false;if(kind==='video')media.pause();media.removeAttribute('src');placeholder.hidden=false;}sync();return true;},stopEvent(event){return !['drop','paste','copy','cut'].includes(event.type);},ignoreMutation(){return true;},destroy(){destroyed=true;sourceVersion++;sourceAbort.abort();abort.abort();if(kind==='video'){media.pause();media.removeAttribute('src');media.load();}}};
}
export function mountStandaloneVideo(container,src,title){const node={attrs:{src,alt:title},type:'video'},view=mediaNodeView({node,editor:null,getSource:()=>src,loadSource:async()=>src,kind:'video',standalone:true});container.append(view.dom);view.selectNode();return view;}
