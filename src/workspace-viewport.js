// Keep the editing controls in the visible viewport, including above a phone keyboard.
export function trackWorkspaceViewport(onKeyboardClose=()=>{}) {
  const viewport=window.visualViewport;
  if(!viewport)return()=>{};
  const root=document.documentElement;
  let expandedHeight=Math.max(viewport.height,window.innerHeight),lastWidth=viewport.width,keyboardWasOpen=false;
  function update(){
    // Preserve native pinch zoom. Only follow keyboard/browser-chrome changes at normal scale.
    if(Math.abs(viewport.scale-1)>.01)return;
    if(Math.abs(viewport.width-lastWidth)>80){expandedHeight=Math.max(viewport.height,window.innerHeight);keyboardWasOpen=false;}
    lastWidth=viewport.width;expandedHeight=Math.max(expandedHeight,viewport.height);
    const missingHeight=expandedHeight-viewport.height;
    const keyboardClosed=keyboardWasOpen&&missingHeight<80;
    if(missingHeight>140)keyboardWasOpen=true;else if(keyboardClosed)keyboardWasOpen=false;
    root.style.setProperty('--workspace-height',`${viewport.height}px`);
    root.style.setProperty('--workspace-top',`${viewport.offsetTop}px`);
    if(keyboardClosed)onKeyboardClose();
  }
  viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);update();
  return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);root.style.removeProperty('--workspace-height');root.style.removeProperty('--workspace-top');};
}
