function spawnBub(o){
  if(bubCount>=BUB_MAX||reduced)return;
  o=o||{};const s=o.size||20+Math.random()*58;
  const el=document.createElement('div');el.className='bub';
  const skin=document.createElement('div');
  skin.className='bubskin '+(o.color||BCOLORS[Math.floor(Math.random()*BCOLORS.length)]);
  skin.style.setProperty('--bdur',(7+Math.random()*6).toFixed(1)+'s');
  if(view==='couple'){skin.classList.add('heart');skin.innerHTML=heartSVG(skin.classList[1]);}
  if(o.born){skin.classList.add('born');requestAnimationFrame(()=>requestAnimationFrame(()=>skin.classList.remove('born')));}
  el.appendChild(skin);
  el.style.width=el.style.height=s.toFixed(0)+'px';
  const hw=hero.clientWidth,hh=hero.clientHeight;
  const x=o.x!=null?o.x:Math.random()*(hw-s);
  const y=o.y!=null?o.y:hh+s;
  el.style.left=x+'px';el.style.top=y+'px';
  const dur=18+Math.random()*16;
  el.style.setProperty('--dur',dur.toFixed(1)+'s');
  el.style.setProperty('--delay',(o.delay||0)+'s');
  el.style.setProperty('--rise',-(y+s+30)+'px');
  el.style.setProperty('--dx',((Math.random()-.5)*70+(o.dx||0)).toFixed(0)+'px');
  el.dataset.size=s;
  bubbles.appendChild(el);bubCount++;
  el.addEventListener('animationend',()=>{el.remove();bubCount--;});
  return el;
}
function splitBub(el){
  const skin=el.firstChild,s=+el.dataset.size;
  const r=el.getBoundingClientRect(),hr=hero.getBoundingClientRect();
  const cx=r.left-hr.left+r.width/2,cy=r.top-hr.top+r.height/2;
  skin.classList.add('pop');
  setTimeout(()=>{el.remove();bubCount--;},1100);
  if(s>=26){const ns=s*.62;
    spawnBub({size:ns,x:cx-ns-3,y:cy-ns/2,dx:-46,color:skin.classList[1],born:true});
    spawnBub({size:ns,x:cx+3,y:cy-ns/2,dx:46,color:skin.classList[1],born:true});}
}
function reskinBubs()