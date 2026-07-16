const LEAFC=[['#FFE9A8','#F7C843','#D9A210'],['#B9DCA4','#7BAF6B','#4E7D44'],['#D9AE72','#A9713D','#7A4E26'],['#FFFDF5','#F2E4C8','#D6BE92']];
function leafSVG(ci){const[c1,c2,c3]=LEAFC[ci],id='lg'+(lgid++);
  return `<svg viewBox="0 0 64 68"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient></defs><path d="M32 4 C50 16 56 34 32 56 C8 34 14 16 32 4 Z" fill="url(#${id})"/><path d="M32 10 L32 50 M32 22 L22 30 M32 22 L42 30 M32 34 L24 41 M32 34 L40 41" stroke="${c3}" stroke-width="1.6" fill="none" opacity=".55" stroke-linecap="round"/><path d="M32 56 L32 63" stroke="${c3}" stroke-width="2.2" stroke-linecap="round"/></svg>`}
function heartLeafSVG(ci){const[c1,c2,c3]=LEAFC[ci],id='lg'+(lgid++);
  return `<svg viewBox="0 0 100 96"><defs><radialGradient id="${id}" cx=".34" cy=".28" r="1"><stop offset="0" stop-color="${c1}"/><stop offset=".55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></radialGradient></defs><path d="M50 88 C22 66 4 48 4 28 C4 12 16 3 29 3 C38 3 46 8 50 16 C54 8 62 3 71 3 C84 3 96 12 96 28 C96 48 78 66 50 88 Z" fill="url(#${id})"/><path d="M50 20 L50 80 M50 38 L38 48 M50 38 L62 48 M50 56 L40 64 M50 56 L60 64" stroke="${c3}" stroke-width="1.8" fill="none" opacity=".5" stroke-linecap="round"/><path d="M50 14 Q54 6 60 4" stroke="${c3}" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`}
function spawnLeaf(o){
  if(bubCount>=BUB_MAX||reduced)return;
  o=o||{};const s=o.size||30+Math.random()*42;
  const el=document.createElement('div');el.className='bub';
  const g=document.createElement('div');g.className='gust';
  const skin=document.createElement('div');skin.className='bubskin';
  const ci=o.ci!=null?o.ci:Math.floor(Math.random()*LEAFC.length);
  skin.dataset.ci=ci;
  if(view==='couple'){skin.classList.add('heart');skin.innerHTML=heartLeafSVG(ci)}else skin.innerHTML=leafSVG(ci);
  skin.style.setProperty('--bdur',(3.5+Math.random()*3).toFixed(1)+'s');
  g.appendChild(skin);el.appendChild(g);
  el.style.width=el.style.height=s.toFixed(0)+'px';
  const hw=hero.clientWidth,hh=hero.clientHeight;
  el.style.left=(Math.random()*(hw-s)).toFixed(0)+'px';
  el.style.top=(-s-10)+'px';
  el.style.setProperty('--dur',(16+Math.random()*14).toFixed(1)+'s');
  el.style.setProperty('--delay',(o.delay||0)+'s');
  el.style.setProperty('--fall',(hh+s+40)+'px');
  el.style.setProperty('--dx',((Math.random()-.5)*140).toFixed(0)+'px');
  bubbles.appendChild(el);bubCount++;
  el.addEventListener('animationend',()=>{el.remove();bubCount--});
  return el;
}
function heartLeafSVG(ci){const[c1,c2,c3]=LEAFC[ci],id='lg'+(lgid++);
  return `<svg viewBox="0 0 100 96"><defs><radialGradient id="${id}" cx=".34" cy=".28" r="1"><stop offset="0" stop-color="${c1}"/><stop offset=".55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></radialGradient></defs><path d="M50 88 C22 66 4 48 4 28 C4 12 16 3 29 3 C38 3 46 8 50 16 C54 8 62 3 71 3 C84 3 96 12 96 28 C96 48 78 66 50 88 Z" fill="url(#${id})"/><path d="M50 20 L50 80 M50 38 L38 48 M50 38 L62 48 M50 56 L40 64 M50 56 L60 64" stroke="${c3}" stroke-width="1.8" fill="none" opacity=".5" stroke-linecap="round"/><path d="M50 14 Q54 6 60 4" stroke="${c3}" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`}
function spawnLeaf(o){
  if(bubCount>=BUB_MAX||reduced)return;
  o=o||{};const s=o.size||30+Math.random()*42;
  const el=document.createElement('div');el.className='bub';
  const g=document.createElement('div');g.className='gust';
  const skin=document.createElement('div');skin.className='bubskin';
  const ci=o.ci!=null?o.ci:Math.floor(Math.random()*LEAFC.length);
  skin.dataset.ci=ci;
  if(view==='couple'){skin.classList.add('heart');skin.innerHTML=heartLeafSVG(ci)}else skin.innerHTML=leafSVG(ci);
  skin.style.setProperty('--bdur',(3.5+Math.random()*3).toFixed(1)+'s');
  g.appendChild(skin);el.appendChild(g);
  el.style.width=el.style.height=s.toFixed(0)+'px';
  const hw=hero.clientWidth,hh=hero.clientHeight;
  el.style.left=(Math.random()*(hw-s)).toFixed(0)+'px';
  el.style.top=(-s-10)+'px';
  el.style.setProperty('--dur',(16+Math.random()*14).toFixed(1)+'s');
  el.style.setProperty('--delay',(o.delay||0)+'s');
  el.style.setProperty('--fall',(hh+s+40)+'px');
  el.style.setProperty('--dx',((Math.random()-.5)*140).toFixed(0)+'px');
  bubbles.appendChild(el);bubCount++;
  el.addEventListener('animationend',()=>{el.remove();bubCount--});
  return el;
}
function spawnLeaf(o){
  if(bubCount>=BUB_MAX||reduced)return;
  o=o||{};const s=o.size||30+Math.random()*42;
  const el=document.createElement('div');el.className='bub';
  const g=document.createElement('div');g.className='gust';
  const skin=document.createElement('div');skin.className='bubskin';
  const ci=o.ci!=null?o.ci:Math.floor(Math.random()*LEAFC.length);
  skin.dataset.ci=ci;
  if(view==='couple'){skin.classList.add('heart');skin.innerHTML=heartLeafSVG(ci)}else skin.innerHTML=leafSVG(ci);
  skin.style.setProperty('--bdur',(3.5+Math.random()*3).toFixed(1)+'s');
  g.appendChild(skin);el.appendChild(g);
  el.style.width=el.style.height=s.toFixed(0)+'px';
  const hw=hero.clientWidth,hh=hero.clientHeight;
  el.style.left=(Math.random()*(hw-s)).toFixed(0)+'px';
  el.style.top=(-s-10)+'px';
  el.style.setProperty('--dur',(16+Math.random()*14).toFixed(1)+'s');
  el.style.setProperty('--delay',(o.delay||0)+'s');
  el.style.setProperty('--fall',(hh+s+40)+'px');
  el.style.setProperty('--dx',((Math.random()-.5)*140).toFixed(0)+'px');
  bubbles.appendChild(el);bubCount++;
  el.addEventListener('animationend',()=>{el.remove();bubCount--});
  return el;
}
function breeze(e){
  const hr=hero.getBoundingClientRect(),dir=(e.clientX-hr.left)<hr.width/2?1:-1;
  $$('#bubbles .gust').forEach(g=>{
    const dx=dir*(50+Math.random()*110),dy=-(16+Math.random()*46),rot=dir*(14+Math.random()*24);
    g.style.transform='translate('+dx.toFixed(0)+'px,'+dy.toFixed(0)+'px) rotate('+rot.toFixed(0)+'deg)';
    clearTimeout(g._bt);g._bt=setTimeout(()=>{g.style.transform='translate(0,0) rotate(0deg)'},2100);});
}