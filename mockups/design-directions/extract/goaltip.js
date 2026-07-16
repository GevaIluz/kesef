function goalTip(g){
  const remaining=g.targetAmount-g.currentAmount;
  if(remaining<=0)return t('tip_done');
  const pace=Math.max(0,M.cycle.income-M.cycle.spent);
  if(g.targetDate){
    const months=Math.max(1,(new Date(g.targetDate)-new Date(M.generatedAt))/(30.44*864e5));
    const need=remaining/months;
    if(need<=pace)return t('tip_ontrack',{need:sh(need),pace:sh(pace),date:fmtDate(g.targetDate)});
    const gap=need-pace,flex=['dining','shopping','entertainment','groceries'];
    let acc=0,parts=[];
    for(const k of flex){const amt=(M.cycle.byCategory.find(c=>c.category===k)||{}).amount||0;
      if(amt<=0)continue;const cut=Math.min(amt*.25,gap-acc);if(cut<=0)break;
      parts.push(tc(k)+' −'+sh(cut));acc+=cut;if(acc>=gap)break;}
    return acc>=gap?t('tip_trim',{need:sh(need),parts:parts.join(' · ')}):t('tip_hard',{need:sh(need)});
  }
  const m2=pace>0?Math.ceil(remaining/pace):null;
  return m2?t('tip_nodate',{pace:sh(pace),m:m2}):t('tip_hard',{need:sh(remaining)});
}