function treeSVG(pr){
  pr=Math.max(0,Math.min(1,pr));
  const sh='<ellipse cx="20" cy="46.4" rx="11" ry="2.2" fill="#122B18" opacity=".55"/>';
  if(pr<.18){const k=pr/.18,st=5+k*8,ty=46-st;
    return sh+'<path d="M20 46 C19.5 '+(46-st*.5).toFixed(1)+' 19.8 '+(ty+2).toFixed(1)+' 20 '+ty.toFixed(1)+'" stroke="#7FB98B" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
    +'<path d="M20 '+(ty+1).toFixed(1)+' C14.5 '+(ty-.5).toFixed(1)+' 13 '+(ty-5).toFixed(1)+' 14.5 '+(ty-7.5).toFixed(1)+' C18.5 '+(ty-6).toFixed(1)+' 20.5 '+(ty-2.5).toFixed(1)+' 20 '+(ty+1).toFixed(1)+' Z" fill="#8FCB9C"/>'
    +'<path d="M20 '+(ty+1).toFixed(1)+' C25.5 '+(ty-.5).toFixed(1)+' 27 '+(ty-5).toFixed(1)+' 25.5 '+(ty-7.5).toFixed(1)+' C21.5 '+(ty-6).toFixed(1)+' 19.5 '+(ty-2.5).toFixed(1)+' 20 '+(ty+1).toFixed(1)+' Z" fill="#5E9468"/>';}
  const g=(pr-.18)/.82,tl=13+g*16,ty=46-tl,tw=1.7+g*2.6,r=4.5+g*7.5,cy=ty-r*.4;
  let s=sh+'<path d="M'+(20-tw).toFixed(1)+' 46 Q'+(20-tw*.5).toFixed(1)+' '+(ty+tl*.5).toFixed(1)+' '+(20-tw*.32).toFixed(1)+' '+ty.toFixed(1)+' L'+(20+tw*.32).toFixed(1)+' '+ty.toFixed(1)+' Q'+(20+tw*.5).toFixed(1)+' '+(ty+tl*.5).toFixed(1)+' '+(20+tw).toFixed(1)+' 46 Z" fill="#6E4A2E"/>';
  if(g>.3){const bw=(0.9+g).toFixed(1);
    s+='<path d="M20 '+(ty+5).toFixed(1)+' Q'+(15.5-g*2).toFixed(1)+' '+(ty+2).toFixed(1)+' '+(13.5-g*2.5).toFixed(1)+' '+(ty-1.5).toFixed(1)+'" stroke="#6E4A2E" stroke-width="'+bw+'" fill="none" stroke-linecap="round"/>';
    s+='<path d="M20 '+(ty+8).toFixed(1)+' Q'+(24.5+g*2).toFixed(1)+' '+(ty+5).toFixed(1)+' '+(26.5+g*2.5).toFixed(1)+' '+(ty+1.5).toFixed(1)+'" stroke="#6E4A2E" stroke-width="'+bw+'" fill="none" stroke-linecap="round"/>';}
  s+='<circle cx="20" cy="'+(cy+r*.28).toFixed(1)+'" r="'+(r*.95).toFixed(1)+'" fill="#35663F"/>'
    +'<circle cx="'+(20-r*.75).toFixed(1)+'" cy="'+(cy+r*.32).toFixed(1)+'" r="'+(r*.62).toFixed(1)+'" fill="#4E8A58"/>'
    +'<circle cx="'+(20+r*.75).toFixed(1)+'" cy="'+(cy+r*.32).toFixed(1)+'" r="'+(r*.62).toFixed(1)+'" fill="#4E8A58"/>'
    +'<circle cx="20" cy="'+(cy-r*.42).toFixed(1)+'" r="'+(r*.68).toFixed(1)+'" fill="#5E9468"/>'
    +'<circle cx="'+(20-r*.32).toFixed(1)+'" cy="'+(cy-r*.5).toFixed(1)+'" r="'+(r*.4).toFixed(1)+'" fill="#8FCB9C" opacity=".85"/>';
  if(g>.5)s+='<circle cx="'+(20+r*.4).toFixed(1)+'" cy="'+(cy+r*.5).toFixed(1)+'" r="'+(r*.16).toFixed(1)+'" fill="#2B5434" opacity=".6"/><circle cx="'+(20-r*.55).toFixed(1)+'" cy="'+(cy+r*.1).toFixed(1)+'" r="'+(r*.13).toFixed(1)+'" fill="#2B5434" opacity=".6"/>';
  if(pr>=.999)s+='<circle cx="'+(20-r*.45).toFixed(1)+'" cy="'+(cy-r*.1).toFixed(1)+'" r="1.9" fill="#F7C843"/><circle cx="'+(20+r*.4).toFixed(1)+'" cy="'+(cy-r*.4).toFixed(1)+'" r="1.9" fill="#F7C843"/><circle cx="'+(20+r*.1).toFixed(1)+'" cy="'+(cy+r*.55).toFixed(1)+'" r="1.9" fill="#F7C843"/>';
  return s;
}