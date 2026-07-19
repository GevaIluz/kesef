/* ── autumn leaves: top-down drift; click = breeze ── */
const hero=$('#hero'),bubbles=$('#bubbles');
const LEAFC=[['#FFE9A8','#F7C843','#D9A210'],['#DFF3E0','#9CCFA6','#5E9468'],['#FFFFFF','#F4EEDD','#CFC5A6'],['#B6D9BC','#6FAE7C','#3F7A4E']];
let lgid=0,bubCount=0;const BUB_MAX=14;
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
  skin.dataset.wind=Math.random()<.5?'tumble':'spin';
  skin.style.setProperty('--bdur',(2.6+Math.random()*1.8).toFixed(1)+'s');skin.style.setProperty('--base',(72+Math.random()*36).toFixed(0)+'deg');skin.style.setProperty('--amp',(10+Math.random()*16).toFixed(0)+'px');
  g.appendChild(skin);el.appendChild(g);
  el.style.width=el.style.height=s.toFixed(0)+'px';
  const hw=bubbles.clientWidth;
  const pond=document.querySelector('.pond');
  const py=pond?pond.offsetTop+pond.offsetHeight*.45:bubbles.clientHeight;
  const dist=py-s/2+s+10;
  el.style.left=(Math.random()*(hw-s)).toFixed(0)+'px';
  el.style.top=(-s-10)+'px';
  el.style.setProperty('--dur',(dist/(85+Math.random()*45)).toFixed(1)+'s');
  el.style.setProperty('--delay',(o.delay||0)+'s');
  el.style.setProperty('--fall',dist.toFixed(0)+'px');
  el.style.setProperty('--dx',((Math.random()-.5)*26).toFixed(0)+'px');
  bubbles.appendChild(el);bubCount++;
  el.addEventListener('animationend',()=>{
    bubCount--;
    const pond2=document.querySelector('.pond');
    if(pond2&&!el._landed){el._landed=1;
      const px=parseFloat(el.style.left)+s/2-pond2.offsetLeft;
      const pyIn=py-pond2.offsetTop;
      if(px>8&&px<pond2.offsetWidth-8){
        const rp=document.createElement('span');rp.className='pring';
        rp.style.cssText='left:'+px.toFixed(0)+'px;top:'+pyIn.toFixed(0)+'px;width:120px;height:38px;margin:-19px 0 0 -60px;animation:pring 2.8s ease-out 1';
        pond2.appendChild(rp);setTimeout(()=>rp.remove(),2900);
      }
      const tf=getComputedStyle(el).transform;
      el.style.animation='none';el.style.transform=tf==='none'?'':tf;
      el.style.transition='opacity 1.6s .3s ease';
      requestAnimationFrame(()=>{el.style.opacity='0'});
      setTimeout(()=>el.remove(),2100);
    }else{el.remove()}
  });
  return el;
}
function reskinBubs(){$$('#bubbles .bubskin').forEach(sk=>{const heart=view==='couple';if(heart===sk.classList.contains('heart'))return;sk.classList.toggle('heart',heart);const ci=+sk.dataset.ci||0;sk.innerHTML=heart?heartLeafSVG(ci):leafSVG(ci)})}
function breeze(e){
  const dir=e.clientX<innerWidth/2?1:-1;
  $$('#bubbles .gust').forEach(g=>{
    const r=g.getBoundingClientRect(),d=Math.hypot(r.left+r.width/2-e.clientX,r.top+r.height/2-e.clientY);
    const k=Math.max(.25,1-d/900);
    const dx=dir*(50+Math.random()*110)*k,dy=-(16+Math.random()*46)*k,rot=dir*(14+Math.random()*24)*k;
    g.style.transform='translate('+dx.toFixed(0)+'px,'+dy.toFixed(0)+'px) rotate('+rot.toFixed(0)+'deg)';
    const sk=g.querySelector('.bubskin');if(sk){sk.classList.add('windy',sk.dataset.wind);clearTimeout(sk._wt);sk._wt=setTimeout(()=>sk.classList.remove('windy','tumble','spin'),2600)}
    clearTimeout(g._bt);g._bt=setTimeout(()=>{g.style.transform='translate(0,0) rotate(0deg)'},2100);});
}
document.addEventListener('click',e=>{if(!e.target.closest('button,a,input,.chip,.cycle-track,.seg,.modal-c,.goal,.tx,.row'))breeze(e)});
if(!reduced){for(let i=0;i<8;i++)spawnLeaf({delay:i*1.1});setInterval(()=>spawnLeaf(),2600)}
