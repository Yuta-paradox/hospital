const W={critical:{e:.35,d:.15,a:.15,f:.25,p:.10},stable:{e:.20,d:.20,a:.30,f:.20,p:.10}}; // illustrative weights, validate clinically
const km=(a,b,c,d)=>{const q=Math.PI/180,x=Math.sin((c-a)*q/2)**2+Math.cos(a*q)*Math.cos(c*q)*Math.sin((d-b)*q/2)**2;return 12742*Math.asin(Math.sqrt(x))};
async function osrm(o,hs,est){try{const c=[o,...hs].map(p=>p.lng+','+p.lat).join(';'),
 r=await fetch(`${process.env.OSRM_URL||'https://router.project-osrm.org'}/table/v1/driving/${c}?sources=0&destinations=${hs.map((_,i)=>i+1).join(';')}&annotations=duration,distance`,{headers:{'User-Agent':'bed-coordination-app'},signal:AbortSignal.timeout(4000)}).then(r=>r.json());
 if(r.code!=='Ok')throw 0;const e=est();return hs.map((_,i)=>r.durations[0][i]!=null?{km:r.distances[0][i]/1000,min:r.durations[0][i]/60,src:'osrm'}:e[i])}catch{return est()}}
async function travel(o,hs){
 const est=()=>hs.map(h=>{const d=km(o.lat,o.lng,h.lat,h.lng)*1.3;return{km:d,min:d/40*60,src:'estimate'}});
 if(!process.env.GOOGLE_MAPS_API_KEY)return osrm(o,hs,est);
 try{const w=p=>({waypoint:{location:{latLng:{latitude:p.lat,longitude:p.lng}}}});
  const r=await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':process.env.GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':'originIndex,destinationIndex,duration,distanceMeters'},
   body:JSON.stringify({origins:[w(o)],destinations:hs.map(w),travelMode:'DRIVE',routingPreference:'TRAFFIC_AWARE'})});
  const rows=await r.json();if(!Array.isArray(rows))throw new Error('routes');const out=est();
  rows.forEach(x=>{if(x.duration)out[x.destinationIndex]={km:x.distanceMeters/1000,min:parseInt(x.duration)/60,src:'google'}});return out}catch{return est()}}
export async function rank(o,hs,urgency,soft){
 const t=await travel(o,hs),w=W[urgency]||W.stable,mE=Math.min(...t.map(x=>x.min)),mD=Math.min(...t.map(x=>x.km));
 const r=hs.map((h,i)=>{const f={e:mE/Math.max(t[i].min,.1),d:mD/Math.max(t[i].km,.1),a:Math.min(h.free,5)/5,f:soft.length?soft.filter(n=>h.facilities.includes(n)).length/soft.length:1,p:h.emergency_level/3};
  return{...h,eta_min:+t[i].min.toFixed(0),distance_km:+t[i].km.toFixed(1),eta_source:t[i].src,missing:soft.filter(n=>!h.facilities.includes(n)),score:Object.keys(w).reduce((s,k)=>s+w[k]*f[k],0),f}}).sort((a,b)=>b.score-a.score);
 if(r[0]){const n={e:'shortest travel time',d:'closest',a:'most free beds',f:'matching facilities',p:'emergency capability'};
  r[0].why=Object.keys(w).sort((a,b)=>r[0].f[b]*w[b]-r[0].f[a]*w[a]).slice(0,2).map(k=>n[k]).join(' and ')}
 return r}
