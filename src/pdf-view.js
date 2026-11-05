import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { icon } from './icons.js';
pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
export async function mountPdf(container,bytes,signal){
  container.innerHTML=`<div class="pdf-tools"><button class="secondary" data-prev aria-label="Föregående sida">${icon('up')}</button><output></output><button class="secondary" data-next aria-label="Nästa sida">${icon('down')}</button><button class="secondary" data-less aria-label="Zooma ut PDF">${icon('minus')}</button><button class="secondary" data-more aria-label="Zooma in PDF">${icon('plus')}</button></div><div class="pdf-status" role="status">Laddar PDF…</div><div class="pdf-paper"><canvas role="img"></canvas></div>`;
  const asset=new URL(/* @vite-ignore */ '../pdfjs/',import.meta.url).href;
  const task=pdfjs.getDocument({data:bytes.slice(),cMapUrl:`${asset}cmaps/`,cMapPacked:true,standardFontDataUrl:`${asset}standard_fonts/`,wasmUrl:`${asset}wasm/`,iccUrl:`${asset}iccs/`,isEvalSupported:false,enableXfa:false});
  let pdf,renderTask,dead=false,pageNumber=1,zoom=1,version=0,resizeFrame,lastWidth=-1;
  const canvas=container.querySelector('canvas'),paper=container.querySelector('.pdf-paper'),status=container.querySelector('.pdf-status'),counter=container.querySelector('output');
  const observer=new ResizeObserver(()=>{if(Math.abs(paper.clientWidth-lastWidth)<1)return;lastWidth=paper.clientWidth;cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(pdf&&!dead)void render();});});
  function destroy(){if(dead)return;dead=true;version++;observer.disconnect();cancelAnimationFrame(resizeFrame);renderTask?.cancel();void task.destroy().catch(()=>{});signal?.removeEventListener('abort',destroy);canvas.width=canvas.height=0;}
  signal?.addEventListener('abort',destroy,{once:true});if(signal?.aborted){destroy();throw new DOMException('Avbrutet','AbortError');}
  async function render(){
    const own=++version;renderTask?.cancel();status.textContent='Laddar sida…';counter.value=`Sida ${pageNumber} av ${pdf.numPages}`;
    container.querySelector('[data-prev]').disabled=pageNumber<=1;container.querySelector('[data-next]').disabled=pageNumber>=pdf.numPages;
    try{
      const page=await pdf.getPage(pageNumber);if(dead||own!==version)return;
      const original=page.getViewport({scale:1}),scale=Math.max(.1,(paper.clientWidth-24)/original.width)*zoom,viewport=page.getViewport({scale});
      const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(12_000_000/(viewport.width*viewport.height)));
      // Finish cancellation before reusing the same canvas.
      if(renderTask)try{await renderTask.promise;}catch{}
      if(dead||own!==version)return;
      canvas.width=Math.max(1,Math.floor(viewport.width*ratio));canvas.height=Math.max(1,Math.floor(viewport.height*ratio));canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;canvas.setAttribute('aria-label',`PDF sida ${pageNumber}`);
      renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]});await renderTask.promise;
      if(!dead&&own===version)status.textContent='';
    }catch(error){if(!dead&&own===version&&error.name!=='RenderingCancelledException')status.textContent='Sidan kunde inte visas. Prova att ladda ner PDF-filen.';}
  }
  try{pdf=await task.promise;if(dead)throw new DOMException('Avbrutet','AbortError');
    container.querySelector('[data-prev]').onclick=()=>{if(pageNumber>1){pageNumber--;paper.scrollTop=0;void render();}};
    container.querySelector('[data-next]').onclick=()=>{if(pageNumber<pdf.numPages){pageNumber++;paper.scrollTop=0;void render();}};
    container.querySelector('[data-less]').onclick=()=>{zoom=Math.max(.5,zoom/1.25);void render();};container.querySelector('[data-more]').onclick=()=>{zoom=Math.min(4,zoom*1.25);void render();};
    await render();lastWidth=paper.clientWidth;observer.observe(paper);return{destroy};
  }catch(error){destroy();throw error;}
}
