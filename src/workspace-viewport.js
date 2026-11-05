// Keep the editing controls in the visible viewport, including above a phone keyboard.
export function trackWorkspaceViewport() {
  const viewport=window.visualViewport;
  if(!viewport)return()=>{};
  const root=document.documentElement;
  function update(){
    // Preserve native pinch zoom. Only follow keyboard/browser-chrome changes at normal scale.
    if(Math.abs(viewport.scale-1)>.01)return;
    root.style.setProperty('--workspace-height',`${viewport.height}px`);
    root.style.setProperty('--workspace-top',`${viewport.offsetTop}px`);
  }
  viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);update();
  return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);root.style.removeProperty('--workspace-height');root.style.removeProperty('--workspace-top');};
}
