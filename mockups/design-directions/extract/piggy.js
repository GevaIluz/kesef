function updatePiggy(){
  const cats=[...M.cycle.byCategory].sort((a,b)=>b.amount-a.amount).slice(0,6);
  if(!cats.find(c=>c.category===pgCat))pgCat=cats[0].category;
  $('#pg-h').textContent=t('pg_h');$('#pg-sub').textContent=t('pg_sub');
  $('#pg-cat-l').textContent=t('pg_cat');$('#pg-cut-l').textContent=t('pg_cut');$('#pg-yr-l').textContent=t('pg_years');
  $('#pg-cats').innerHTML=cats.map(c=>`<button class="pg-chip ${c.category===pgCat?'on':''}" data-cat="${c.category}">${ic(c.category,13)} ${tc(c.category)}</button>`).join('');
  $$('#pg-cats .pg-chip').forEach(b=>b.onclick=()=>{pgCat=b.dataset.cat;updatePiggy()});
  const base=(M.cycle.byCategory.find(c=>c.category===pgCat)||{amount:0}).amount;
  const monthly=base*pgCut/100,r=0.04/12,n=pgYr*12;
  const fv=monthly*((Math.pow(1+r,n)-1)/r);
  $('#pg-cut-v').textContent=pgCut+'%';$('#pg-yr-v').textContent=pgYr+' '+t('pg_yr_u');
  $('#pg-monthly').textContent=t('pg_monthly',{m:sh(monthly)});
  countUp($('#pg-fv'),fv);
  $('#pg-fv-k').textContent=t('pg_fv_k',{y:pgYr});
  $('#pg-note').textContent=t('pg_note');
  $('#pg-piggy').style.setProperty('--cd',Math.max(.55,2.4-monthly/400).toFixed(2)+'s');
}