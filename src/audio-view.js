export function mountAudio(container,url,title){
  const heading=document.createElement('h2');heading.textContent=title;
  const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=url;audio.setAttribute('aria-label',title);
  const status=document.createElement('p');status.className='muted';status.setAttribute('role','status');status.textContent='Förbereder ljud…';
  audio.addEventListener('loadedmetadata',()=>status.textContent='Spela, pausa och spola med reglagen.');audio.addEventListener('error',()=>status.textContent='Ljudformatet kan inte spelas i den här webbläsaren. Filen kan laddas ner.');
  container.append(heading,audio,status);
  return{destroy(){audio.pause();audio.removeAttribute('src');audio.load();}};
}
