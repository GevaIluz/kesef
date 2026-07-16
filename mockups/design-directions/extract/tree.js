function treeSVG(pr){
  pr=Math.max(0,Math.min(1,pr));
  const ground='<ellipse cx="20" cy="46" rx="10" ry="2" fill="#A9CF7E"/>';
  if(pr<.18){const k=pr/.18,st=5+k*7,ty=46-st;
    return ground+'<path d="M20 46 L20 '+ty.toFixed(1)+'" stroke="#5F9E52" stroke-width="2" stroke-linecap="round"/>'
    +'<path d="M20 '+ty.toFixed(1)+' C15 '+(ty-1).toFixed(1)+' 14 '+(ty-5).toFixed(1)+' 15 '+(ty-7).toFixed(1)+' C19 '+(ty-6).toFixed(1)+' 21 '+(ty-3).toFixed(1)+' 20 '+ty.toFixed(1)+' Z" fill="#7BAF6B"/>'
    +'<path d="M20 '+ty.toFixed(1)+' C25 '+(ty-1).toFixed(1)+' 26 '+(ty-5).toFixed(1)+' 25 '+(ty-7).toFixed(1)+' C21 '+(ty-6).toFixed(1)+' 19 '+(ty-3).toFixed(1)+' 20 '+ty.toFixed(1)+' Z" fill="#5F9E52"/>';}
  const g=(pr-.18)/.82,tl=12+g*15,ty=46-tl,r=4+g*7,cy=ty-r*.55;
  let s=ground+'<path d="M20 46 L20 '+ty.toFixed(1)+'" stroke="var(--bark)" stroke-width="'+(2+g*2.5).toFixed(1)+'" stroke-linecap="round"/>';
  if(g>.35)s+='<path d="M20 '+(ty+6).toFixed(1)+' L'+(14-g*2).toFixed(1)+' '+(ty+1).toFixed(1)+' M20 '+(ty+9).toFixed(1)+' L'+(26+g*2).toFixed(1)+' '+(ty+4).toFixed(1)+'" stroke="var(--bark)" stroke-width="'+(1.4+g).toFixed(1)+'" stroke-linecap="round"/>';
  s+='<circle cx="20" cy="'+cy.toFixed(1)+'" r="'+r.toFixed(1)+'" fill="#5F9E52"/><circle cx="'+(20-r*.7).toFixed(1)+'" cy="'+(cy+r*.35).toFixed(1)+'" r="'+(r*.6).toFixed(1)+'" fill="#7BAF6B"/><circle cx="'+(20+r*.7).toFixed(1)+'" cy="'+(cy+r*.35).toFixed(1)+'" r="'+(r*.6).toFixed(1)+'" fill="#7BAF6B"/>';
  if(pr>=.999)s+='<circle cx="'+(20-r*.4).toFixed(1)+'" cy="'+(cy-r*.2).toFixed(1)+'" r="2" fill="#F7C843"/><circle cx="'+(20+r*.35).toFixed(1)+'" cy="'+(cy-r*.45).toFixed(1)+'" r="2" fill="#F7C843"/><circle cx="20" cy="'+(cy+r*.4).toFixed(1)+'" r="2" fill="#F7C843"/>';
  return s;
}