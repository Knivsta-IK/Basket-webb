import { icon } from './icons.js';

export function mountEditorTools(bar){
  const recent=document.createElement('div');recent.className='recent-tools';
  const dropdown=document.createElement('div');dropdown.className='tools-dropdown';dropdown.id='more-tools';dropdown.hidden=true;dropdown.setAttribute('aria-label','Alla verktyg');

  const more=document.createElement('button');more.type='button';more.id='more-tools-button';more.title='Fler verktyg';more.setAttribute('aria-label','Fler verktyg');more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls','more-tools');more.innerHTML=icon('more');
  const type=bar.querySelector('select');const label=document.createElement('label');label.textContent='Texttyp';label.append(type);dropdown.append(label);
  const tools=[...bar.querySelectorAll('button')];const ids=['bold','italic','color','underline','link','image','undo','redo'];
  tools.forEach((button,index)=>{button.dataset.tool=ids[index];const caption=document.createElement('span');caption.className='tool-caption';caption.textContent=button.getAttribute('aria-label');button.append(caption);});
  let order=['bold','italic','image','undo',...ids.filter(id=>!['bold','italic','image','undo'].includes(id))];
  bar.replaceChildren(recent,more,dropdown);
  function close(){dropdown.hidden=true;more.setAttribute('aria-expanded','false');}
  function render(){
    const available=bar.clientWidth-24-48;
    const count=Math.min(4,Math.max(1,Math.floor(available/48)));
    order.forEach((id,index)=>{const button=tools.find(b=>b.dataset.tool===id);(index<count?recent:dropdown).append(button);});
  }
  more.onmousedown=event=>event.preventDefault();more.onclick=()=>{const open=dropdown.hidden;dropdown.hidden=!open;more.setAttribute('aria-expanded',String(open));};
  const abort=new AbortController();
  // Keep the editor selection and keyboard stable until a tapped tool receives its click.
  bar.addEventListener('mousedown',event=>{if(event.target.closest('[data-tool],#more-tools-button'))event.preventDefault();},{capture:true,signal:abort.signal});
  bar.addEventListener('click',event=>{const button=event.target.closest('[data-tool]');if(!button)return;const wasInDropdown=dropdown.contains(button);order=[button.dataset.tool,...order.filter(id=>id!==button.dataset.tool)];if(wasInDropdown)close();queueMicrotask(render);},{signal:abort.signal});
  type.addEventListener('change',close,{signal:abort.signal});
  document.addEventListener('pointerdown',event=>{if(!bar.contains(event.target))close();},{signal:abort.signal});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dropdown.hidden){close();more.focus();}},{signal:abort.signal});
  const resize=new ResizeObserver(render);resize.observe(bar);render();
  return{setFocus(){close();render();},close,destroy(){abort.abort();resize.disconnect();}};
}
