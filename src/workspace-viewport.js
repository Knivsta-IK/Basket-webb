// Follow the visible viewport without treating Safari's browser chrome as keyboard space.
export function trackWorkspaceViewport(onKeyboardClose=()=>{}) {
  const viewport=window.visualViewport;
  if(!viewport)return()=>{};
  const root=document.documentElement;
  const debug=new URLSearchParams(location.search).has('keyboard-debug');
  const records=[];
  let lastWidth=viewport.width*viewport.scale,expandedHeight=viewport.height*viewport.scale,keyboardFloor=null,lastRecord='',timer;
  let debugButton;
  if(debug){
    debugButton=document.createElement('button');debugButton.type='button';debugButton.textContent='Kopiera felsökning';
    debugButton.style.cssText='position:fixed;right:8px;bottom:8px;z-index:1000;padding:10px;background:#343b6b;color:white;border-radius:8px;font-size:12px';
    debugButton.onclick=async()=>{const data=JSON.stringify({version:'keyboard-20261105-2',events:records},null,2);try{await navigator.clipboard.writeText(data);debugButton.textContent='Kopierat';}catch{const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='felsokning.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}};
    document.body.append(debugButton);
  }
  function update(){
    // Normalize scale for keyboard detection; preserve native pinch zoom for layout.
    const scale=viewport.scale||1,height=viewport.height*scale,width=viewport.width*scale;
    if(Math.abs(width-lastWidth)>80){expandedHeight=height;keyboardFloor=null;}
    lastWidth=width;
    const editing=document.body.classList.contains('editing-focus');
    let closed=false;
    if(keyboardFloor===null){
      if(editing&&expandedHeight-height>100)keyboardFloor=height;
      else expandedHeight=Math.max(expandedHeight,height);
    }else{
      keyboardFloor=Math.min(keyboardFloor,height);
      // Safari's expanded browser UI may leave the restored viewport shorter than before editing.
      const restored=Math.max(90,(expandedHeight-keyboardFloor)*.5);
      if(height-keyboardFloor>=restored){closed=true;keyboardFloor=null;expandedHeight=height;}
    }
    if(Math.abs(scale-1)<.01){root.style.setProperty('--workspace-height',`${viewport.height}px`);root.style.setProperty('--workspace-top',`${viewport.offsetTop}px`);}
    if(debug){const record={height:Math.round(height),visibleHeight:Math.round(viewport.height),offset:Math.round(viewport.offsetTop),scale,expanded:Math.round(expandedHeight),keyboardFloor,editing,active:document.activeElement?.tagName,closed};const signature=JSON.stringify(record);if(signature!==lastRecord){lastRecord=signature;records.push({at:Date.now(),...record});if(records.length>120)records.shift();}}
    if(closed)onKeyboardClose();
  }
  const abort=new AbortController(),options={signal:abort.signal};
  viewport.addEventListener('resize',update,options);viewport.addEventListener('scroll',update,options);window.addEventListener('resize',update,options);document.addEventListener('focusin',update,options);document.addEventListener('focusout',()=>queueMicrotask(update),options);
  // Some iOS browser containers update the geometry without a corresponding resize event.
  timer=setInterval(()=>{if(keyboardFloor!==null||document.body.classList.contains('editing-focus')||debug)update();},150);
  update();
  return()=>{abort.abort();clearInterval(timer);debugButton?.remove();root.style.removeProperty('--workspace-height');root.style.removeProperty('--workspace-top');};
}
