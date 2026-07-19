const segs=[{k:t('tax'),v:p.tax,c:'#8A7E6D'},{k:t('pension'),v:mine,c:'#C76699'},{k:t('espp'),v:p.espp,c:'#DE9C1E'},{k:t('net'),v:p.net,c:'#16A78C'}];
  {const tot=segs.reduce((a,s)=>a+s.v,0),cx=79,cy=79,RR=70,rr=44;let a0=-Math.PI/2,out='<svg viewBox="0 0 158 158">';
  segs.forEach((s,ix)=>{const a1=a0+s.v/tot*2*Math.PI,large=(a1-a0)>Math.PI?1:0;
    const p2=(a,r2)=>`${(cx+r2*Math.cos(a)).toFixed(2)} ${(cy+r2*Math.sin(a)).toFixed(2)}`;
    out+=`<path class="donut-seg" style="animation-delay:${.4+ix*.09}s" d="M${p2(a0,RR)}A${RR} ${RR} 0 ${large} 1 ${p2(a1,RR)}L${p2(a1,rr)}A${rr} ${rr} 0 ${large} 0 ${p2(a0,rr)}Z" fill="${s.c}"><title>${s.k} · ${sh(s.v)}</title></path>`;a0=a1;});
  out+=`<text x="79" y="75" text-anchor="middle" style="font-family:var(--round);font-size:16px" fill="var(--ink)">${sh(p.gross)}</text><text x="79" y="92" text-anchor="middle" style="font-size:9.5px" fill="var(--soft)">${t('gross')}</text></svg>`;
  $('#pay-flow').innerHTML=out;}
  