export async function api(u,o){const r=await fetch(u,o?{method:o.m||'POST',headers:{'Content-Type':'application/json',...(o.h||{})},body:JSON.stringify(o.b||{})}:{cache:'no-store'});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
export const ago=t=>{const m=Math.round((Date.now()-new Date(t))/6e4);return m<1?'just now':m<60?m+' min ago':Math.round(m/60)+' h ago'};
export const stale=t=>Date.now()-new Date(t)>2*36e5;
