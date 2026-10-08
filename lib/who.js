// WHO Global Health Observatory: free, no key. National statistic for context only, NOT live capacity.
export async function whoBeds(){try{const g='https://ghoapi.azureedge.net/api/',o={next:{revalidate:86400}};
 const ind=(await fetch(`${g}Indicator?$filter=contains(IndicatorName,'hospital beds')`,o).then(r=>r.json())).value||[];if(!ind.length)return null;
 const rows=(await fetch(`${g}${ind[0].IndicatorCode}?$filter=SpatialDim eq 'IND'`,o).then(r=>r.json())).value||[];
 const x=rows.filter(r=>r.NumericValue!=null).sort((a,b)=>b.TimeDim-a.TimeDim)[0];return x?{name:ind[0].IndicatorName,value:x.NumericValue,year:x.TimeDim}:null}catch{return null}}
