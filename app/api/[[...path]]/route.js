import {randomUUID,randomInt,createHash} from 'crypto';
import {sendMail} from '@/lib/mail';
import {cookies} from 'next/headers';
import {db,oid,pub,J,sweep,audit,limited,tooMany,ip} from '@/lib/db';
import {session,setSession,hash,check} from '@/lib/auth';
import {rank} from '@/lib/rank';
import {BED_TYPES,BED_STATUS,FACILITIES,DECLINE_REASONS} from '@/lib/constants';

export const dynamic='force-dynamic';
export const runtime='nodejs';

// ---------- tiny router: one function serves every /api/* path ----------
class E extends Error{constructor(m,c){super(m);this.c=c}}
const routes=[];
const on=(m,p,f)=>routes.push([m,new RegExp('^'+p.replace(':id','([^/]+)')+'$'),f]);
async function handle(req,{params}){
  const path=(params.path||[]).join('/');
  for(const[m,re,f]of routes){
    if(m!==req.method)continue;const x=re.exec(path);if(!x)continue;
    try{return await f(req,x[1])}
    catch(e){
      if(e instanceof E)return J({error:e.message},e.c);
      if(e.code===11000)return J({error:'Already exists'},409);
      if(e.message==='MAIL_NOT_CONFIGURED')return J({error:'Email service is not configured (set RESEND_API_KEY and MAIL_FROM)'},503);
      if(e.message==='MAIL_FAILED')return J({error:'Could not send the verification email. Try again.'},502);
      console.error(path,e);
      return J({error:/MONGODB_URI/.test(e.message)?'Database is not configured (set MONGODB_URI)':'Server error'},/MONGODB_URI/.test(e.message)?503:500);
    }
  }
  return J({error:'Not found'},404);
}
export const GET=handle,POST=handle,PATCH=handle,DELETE=handle;

const col=async n=>(await db()).collection(n);
const staff=async(adminOnly)=>{const s=await session();if(!s)throw new E('Not signed in',401);if(adminOnly&&s.role!=='admin')throw new E(adminOnly===true?'Administrator access required':adminOnly,403);return{...s,h:oid(s.hid)}};
const platform=req=>{if(!process.env.PLATFORM_KEY||req.headers.get('x-platform-key')!==process.env.PLATFORM_KEY)throw new E('Wrong platform key',401)};
const str=v=>String(v??'').trim();

// Response windows. Critical cases get a short window; the patient app then auto-redirects.
const WINDOW={critical:3,stable:10};   // minutes the hospital has to respond
const ARRIVE_MIN=30;                    // minutes the patient has to arrive after confirmation
const ESCALATE_S=60;                    // critical + unanswered this long => flagged to the control room

// ---------- health ----------
on('GET','health',async()=>{
  try{await (await db()).command({ping:1});return J({ok:true,db:true,routing:process.env.GOOGLE_MAPS_API_KEY?'google':'osrm'})}
  catch(e){return J({ok:false,db:false,error:process.env.MONGODB_URI?'Cannot connect to MongoDB':'MONGODB_URI is not set'},503)}
});

// ---------- auth: every account must verify its email before it can sign in ----------
const FREE=['gmail.com','googlemail.com','yahoo.com','yahoo.in','yahoo.co.in','ymail.com','outlook.com','hotmail.com','live.com','msn.com','rediffmail.com','icloud.com','me.com','aol.com','proton.me','protonmail.com','gmx.com','mail.com','zoho.com'];
const okPw=p=>/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/.test(String(p||''));
const PW_MSG='Password must be at least 10 characters with an upper-case letter, a lower-case letter and a digit';
const hc=c=>createHash('sha256').update(c+(process.env.AUTH_SECRET||'')).digest('hex');
const host=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)&&x.hostname.includes('.')?x.hostname.replace(/^www\./,'').toLowerCase():null}catch{return null}};
const km=(a,b,c,d)=>{const q=Math.PI/180,x=Math.sin((c-a)*q/2)**2+Math.cos(a*q)*Math.cos(c*q)*Math.sin((d-b)*q/2)**2;return 12742*Math.asin(Math.sqrt(x))};
async function issueCode(email){   // 6-digit code, 15 minutes, 5 tries; returns the code only in dev mode (no email service)
  const O=await col('otps'),code=String(randomInt(100000,1000000));
  await O.deleteOne({_id:email});await O.insertOne({_id:email,h:hc(code),expires_at:new Date(Date.now()+15*6e4),tries:0});
  const m=await sendMail(email,'Your Bed Coordination verification code',`Your verification code is ${code}. It expires in 15 minutes. If you did not request it, ignore this email.`);
  return m.dev?code:undefined;
}
on('POST','auth/login',async req=>{
  if(await limited(req,'login',10,900))return tooMany();
  const{email='',password=''}=await req.json(),e=str(email).toLowerCase(),U=await col('users'),u=await U.findOne({email:e});
  if(u?.locked_until&&new Date(u.locked_until)>new Date())return J({error:'Too many failed attempts. Try again in 15 minutes.'},429);
  if(!u||!await check(String(password),u.password_hash)){
    if(u){const f=(u.failed||0)+1;await U.updateOne({_id:u._id},{$set:f>=5?{failed:0,locked_until:new Date(Date.now()+15*6e4)}:{failed:f}})}
    return J({error:'Wrong email or password'},401);
  }
  if(u.email_verified!==true)return J({ok:true,verify:true,email:e,devCode:await issueCode(e)});   // password right, email not yet proven
  await U.updateOne({_id:u._id},{$set:{failed:0,locked_until:null}});
  await setSession({id:String(u._id),hospital_id:String(u.hospital_id),role:u.role});return J({ok:true});
});
on('POST','auth/verify',async req=>{
  if(await limited(req,'verify',10,900))return tooMany();
  const{email='',code=''}=await req.json(),e=str(email).toLowerCase(),O=await col('otps'),o=await O.findOne({_id:e});
  if(!o||new Date(o.expires_at)<new Date())return J({error:'Code expired. Request a new one.'},400);
  if(o.tries>=5){await O.deleteOne({_id:e});return J({error:'Too many wrong codes. Request a new one.'},429)}
  if(o.h!==hc(str(code))){await O.updateOne({_id:e},{$inc:{tries:1}});return J({error:'Wrong code'},400)}
  await O.deleteOne({_id:e});const U=await col('users'),u=await U.findOne({email:e});if(!u)return J({error:'Account not found'},404);
  await U.updateOne({_id:u._id},{$set:{email_verified:true,email_verified_at:new Date(),failed:0,locked_until:null}});
  await setSession({id:String(u._id),hospital_id:String(u.hospital_id),role:u.role});await audit('user:'+e,'email_verified',{});return J({ok:true});
});
on('POST','auth/resend',async req=>{
  if(await limited(req,'resend',3,600))return tooMany();
  const e=str((await req.json()).email).toLowerCase(),u=await (await col('users')).findOne({email:e,email_verified:{$ne:true}});
  return J({ok:true,devCode:u?await issueCode(e):undefined});   // same answer whether or not the account exists
});
on('POST','auth/logout',async()=>{cookies().delete('s');return J({ok:true})});
on('POST','auth/register',async req=>{
  if(await limited(req,'register',5,3600))return tooMany();
  const b=await req.json();
  for(const k of['name','reg_no','address','city','state','pincode','emergency_phone','website','licence_valid_till','mc_reg_no','staff_name','designation','email','password'])if(!str(b[k]))return J({error:`Missing: ${k}`},400);
  if(!okPw(b.password))return J({error:PW_MSG},400);
  const lat=+b.lat,lng=+b.lng;if(!isFinite(lat)||!isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return J({error:'Valid latitude/longitude required'},400);
  if(!/^[A-Za-z0-9][A-Za-z0-9\/\-. ]{4,39}$/.test(str(b.reg_no)))return J({error:'Registration number looks invalid (5-40 letters, digits, / - .)'},400);
  if(str(b.mc_reg_no).length<4)return J({error:'Medical council registration number of the in-charge doctor is required'},400);
  const wh=host(str(b.website));if(!wh)return J({error:'Enter the hospital website as a full link, e.g. https://example.org'},400);
  const till=new Date(str(b.licence_valid_till)),dayMs=864e5;if(isNaN(+till)||+till<Date.now()||+till>Date.now()+3650*dayMs)return J({error:'Licence validity date must be in the future'},400);
  const pd=str(b.emergency_phone).replace(/\D/g,'');if(pd.length<8||pd.length>13)return J({error:'Enter a valid 24x7 emergency phone number'},400);
  const email=str(b.email).toLowerCase(),dom=email.split('@')[1]||'';if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return J({error:'Enter a valid email'},400);
  if(FREE.includes(dom)&&process.env.ALLOW_FREE_EMAIL!=='1')return J({error:'Use your hospital’s official email address, not a free email service'},400);
  const H=await col('hospitals'),U=await col('users'),dup=J({error:'This registration number, emergency phone or email is already registered'},409);
  if(await U.findOne({email})||await H.findOne({emergency_phone_digits:pd}))return dup;
  const near=(await H.find({},{projection:{name:1,lat:1,lng:1}}).toArray()).find(x=>km(lat,lng,x.lat,x.lng)<0.1);   // another hospital within 100 m
  let h;try{h=await H.insertOne({name:str(b.name),reg_no:str(b.reg_no),type:b.type||'Private',address:str(b.address),city:str(b.city),state:str(b.state),pincode:str(b.pincode),lat,lng,phone:b.phone||null,emergency_phone:str(b.emergency_phone),emergency_phone_digits:pd,website:str(b.website),licence_valid_till:till,mc_reg_no:str(b.mc_reg_no),facilities:(b.facilities||[]).filter(f=>FACILITIES.includes(f)),emergency_level:[1,2,3].includes(+b.emergency_level)?+b.emergency_level:2,status:'pending',verification:null,auto:{email_domain_matches_website:dom===wh||dom.endsWith('.'+wh)||wh.endsWith('.'+dom),near_duplicate:near?near.name:null},registered_ip:ip(req),last_confirmed_at:new Date(),created_at:new Date()})}
  catch(e){if(e.code===11000)return dup;throw e}
  let u;try{u=await U.insertOne({hospital_id:h.insertedId,name:str(b.staff_name),designation:str(b.designation),email,password_hash:await hash(b.password),role:'admin',email_verified:false,created_at:new Date()})}
  catch(e){await H.deleteOne({_id:h.insertedId});if(e.code===11000)return dup;throw e}
  let devCode;try{devCode=await issueCode(email)}catch(e){await U.deleteOne({_id:u.insertedId});await H.deleteOne({_id:h.insertedId});throw e}   // no email service => no account
  await audit('system','hospital_registered',{id:String(h.insertedId)});return J({ok:true,verify:true,email,devCode});
});

// ---------- geocode (OpenStreetMap Nominatim, free, 1 req/s policy) ----------
on('GET','geocode',async req=>{
  if(await limited(req,'geo',30,60))return tooMany();
  const s=new URL(req.url).searchParams.get('q')||'';if(s.length<3)return J([]);
  const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&q='+encodeURIComponent(s),{headers:{'User-Agent':'bed-coordination-app ('+(process.env.APP_CONTACT||'set APP_CONTACT')+')','Accept-Language':'en'}}).then(r=>r.json()).catch(()=>[]);
  return J(Array.isArray(r)?r.map(x=>({name:x.display_name,lat:+x.lat,lng:+x.lon})):[]);
});

// ---------- hospital staff: overview ----------
on('GET','admin/overview',async()=>{
  const s=await staff();await sweep();
  const[H,B,R,U]=await Promise.all([col('hospitals'),col('beds'),col('reservations'),col('users')]);
  const[hospital,beds,reservations,history,users]=await Promise.all([
    H.findOne({_id:s.h}),
    B.find({hospital_id:s.h}).sort({bed_type:1,label:1}).toArray(),
    R.find({hospital_id:s.h,status:{$in:['held','confirmed']}}).sort({created_at:-1}).toArray(),
    R.find({hospital_id:s.h,status:{$nin:['held','confirmed']}}).sort({created_at:-1}).limit(15).toArray(),
    s.role==='admin'?U.find({hospital_id:s.h},{projection:{password_hash:0}}).sort({role:1,_id:1}).toArray():[]]);
  return J({hospital:pub(hospital),beds:beds.map(pub),reservations:reservations.map(pub),history:history.map(pub),staff:users.map(pub),me:{role:s.role},now:Date.now()});
});
on('POST','admin/confirm',async()=>{const s=await staff();await (await col('hospitals')).updateOne({_id:s.h},{$set:{last_confirmed_at:new Date()}});return J({ok:true})});

// ---------- hospital staff: beds ----------
const BAD_BED_MSG='Only the hospital administrator can register or remove beds';
on('POST','admin/beds',async req=>{
  const s=await staff(BAD_BED_MSG),b=await req.json();
  const n=Math.min(100,Math.max(1,+b.count||1)),start=Math.max(1,+b.start||1),prefix=str(b.prefix||b.bed_type).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
  if(!BED_TYPES.includes(b.bed_type)||!prefix)return J({error:'Bed type and label prefix required'},400);
  const now=new Date(),docs=Array.from({length:n},(_,i)=>({hospital_id:s.h,bed_type:b.bed_type,label:`${prefix}-${String(start+i).padStart(2,'0')}`,ward:b.ward||null,floor:b.floor||null,status:'available',has_oxygen:!!b.has_oxygen,has_ventilator:!!b.has_ventilator,has_monitor:!!b.has_monitor,isolation:!!b.isolation,gender:['male','female'].includes(b.gender)?b.gender:'any',updated_at:now,updated_by:s.uid}));
  let added=0;try{added=(await (await col('beds')).insertMany(docs,{ordered:false})).insertedCount}catch(e){if(e.code!==11000&&!e.writeErrors)throw e;added=e.result?.insertedCount??e.insertedCount??0}
  await (await col('hospitals')).updateOne({_id:s.h},{$set:{last_confirmed_at:now}});await audit('hospital:'+s.hid,'beds_added',{type:b.bed_type,n:added});
  return J({added,skipped:n-added});
});
on('PATCH','admin/beds',async req=>{
  const s=await staff(),b=await req.json();
  if(!BED_STATUS.includes(b.status))return J({error:'Invalid status'},400);
  const r=await (await col('beds')).updateOne({_id:oid(b.id)||'x',hospital_id:s.h,status:{$ne:'reserved'}},{$set:{status:b.status,updated_at:new Date(),updated_by:s.uid}});
  if(!r.matchedCount)return J({error:'Bed is reserved for an incoming patient. Release the reservation first.'},409);
  await (await col('hospitals')).updateOne({_id:s.h},{$set:{last_confirmed_at:new Date()}});return J({ok:true});
});
on('DELETE','admin/beds',async req=>{
  const s=await staff(BAD_BED_MSG),id=oid(new URL(req.url).searchParams.get('id')),bad=J({error:'Cannot delete: bed is reserved or has patient history. Mark it as maintenance instead.'},409);
  if(!id||await (await col('reservations')).countDocuments({bed_id:id},{limit:1}))return bad;
  const r=await (await col('beds')).deleteOne({_id:id,hospital_id:s.h,status:{$ne:'reserved'}});return r.deletedCount?J({ok:true}):bad;
});

// ---------- hospital staff: profile + accounts ----------
on('PATCH','admin/profile',async req=>{
  const s=await staff(true),b=await req.json();
  if(!str(b.emergency_phone))return J({error:'Emergency phone is required'},400);
  await (await col('hospitals')).updateOne({_id:s.h},{$set:{phone:b.phone||null,emergency_phone:str(b.emergency_phone),emergency_level:[1,2,3].includes(+b.emergency_level)?+b.emergency_level:2,facilities:(b.facilities||[]).filter(f=>FACILITIES.includes(f))}});
  await audit('hospital:'+s.hid,'profile_updated',{});return J({ok:true});
});
on('POST','admin/staff',async req=>{
  const s=await staff(true),b=await req.json();
  for(const k of['name','designation','email','password'])if(!str(b[k]))return J({error:`Missing: ${k}`},400);
  if(!okPw(b.password))return J({error:PW_MSG},400);
  if(!await (await col('hospitals')).findOne({_id:s.h,status:'verified'}))return J({error:'Your hospital must be verified by the platform before you can add staff'},403);
  try{await (await col('users')).insertOne({hospital_id:s.h,name:str(b.name),designation:str(b.designation),email:str(b.email).toLowerCase(),password_hash:await hash(b.password),role:'staff',email_verified:false,created_at:new Date()})}
  catch(e){if(e.code===11000)return J({error:'That email is already registered'},409);throw e}
  await audit('hospital:'+s.hid,'staff_added',{email:b.email});return J({ok:true},201);
});
on('PATCH','admin/staff',async req=>{
  const s=await staff(true),{id,password}=await req.json();
  if(!okPw(password))return J({error:PW_MSG},400);
  const r=await (await col('users')).updateOne({_id:oid(id)||'x',hospital_id:s.h,role:'staff'},{$set:{password_hash:await hash(password)}});
  return r.matchedCount?J({ok:true}):J({error:'Not found'},404);
});
on('DELETE','admin/staff',async req=>{
  const s=await staff(true),id=oid(new URL(req.url).searchParams.get('id'));
  const r=id&&await (await col('users')).deleteOne({_id:id,hospital_id:s.h,role:'staff'});return r?.deletedCount?J({ok:true}):J({error:'Not found'},404);
});

// ---------- hospital staff: respond to an incoming patient ----------
// confirm: only while the response window is still open (so a late confirm can never steal a bed already handed to someone else)
const ACT={confirm:['confirmed',null],arrive:['arrived','occupied'],release:['released','available'],decline:['declined','available']};
on('POST','admin/reservations/:id',async(req,rid)=>{
  const s=await staff(),{action,reason}=await req.json(),a=ACT[action];
  if(!a)return J({error:'Bad action'},400);
  if(action==='decline'&&!DECLINE_REASONS.includes(reason))return J({error:'Select a reason for declining'},400);
  await sweep();
  const R=await col('reservations'),now=new Date(),set={status:a[0]},f={_id:String(rid),hospital_id:s.h,status:{$in:action==='confirm'?['held']:['held','confirmed']}};
  if(action==='decline')set.decline_reason=reason;
  if(action==='confirm'){set.expires_at=new Date(+now+ARRIVE_MIN*6e4);set.confirmed_at=now;f.expires_at={$gt:now}}else set.closed_at=now;
  const r=await R.findOneAndUpdate(f,{$set:set});            // returns the document as it was before the update
  if(!r){
    const x=await R.findOne({_id:String(rid),hospital_id:s.h});
    if(action==='confirm'&&x?.status==='confirmed')return J({ok:true});   // double click
    const late=x?.status==='expired'?(x.decline_reason==='No response from hospital'?'The response window had already passed: the bed was released and the patient is being sent to the next hospital. Call the patient if they are already on the way.':'The arrival window had passed and the bed was released. If the patient did arrive, mark the bed as occupied manually.'):'Reservation is no longer active';
    return J({error:late},409);
  }
  if(a[1])await (await col('beds')).updateOne({_id:r.bed_id},{$set:{status:a[1],updated_at:now,updated_by:s.uid}});
  await audit('hospital:'+s.hid,action,{id:rid,reason});return J({ok:true});
});

// ---------- platform verifier + control room (PLATFORM_KEY) ----------
on('GET','platform/hospitals',async req=>{
  platform(req);const[H,B,U]=await Promise.all([col('hospitals'),col('beds'),col('users')]);
  const hs=await H.find().toArray(),cnt=new Map((await B.aggregate([{$group:{_id:'$hospital_id',n:{$sum:1}}}]).toArray()).map(x=>[String(x._id),x.n])),mail=new Map();
  for(const u of await U.find({},{projection:{hospital_id:1,email:1}}).sort({_id:1}).toArray())if(!mail.has(String(u.hospital_id)))mail.set(String(u.hospital_id),u.email);
  return J(hs.map(h=>({...pub(h),beds:cnt.get(String(h._id))||0,contact_email:mail.get(String(h._id))})).sort((a,b)=>(b.status==='pending')-(a.status==='pending')||new Date(b.created_at)-new Date(a.created_at)));
});
const CHECKS=['reg_matches','callback_done','location_ok','email_ok'];
on('POST','platform/hospitals',async req=>{
  platform(req);const{id,status,checks,verifier,note}=await req.json();
  if(!['verified','rejected','pending'].includes(status)||!oid(id))return J({error:'Bad status'},400);
  if(status==='verified'&&(!CHECKS.every(k=>checks?.[k]===true)||str(verifier).length<2))return J({error:'Tick every verification check and enter your name before verifying'},400);
  if(status==='rejected'&&str(note).length<3)return J({error:'Give a reason for rejecting'},400);
  await (await col('hospitals')).updateOne({_id:oid(id)},{$set:{status,verification:{checks:checks||{},verifier:str(verifier).slice(0,80),note:str(note).slice(0,300),at:new Date()}}});
  await audit('platform','set_'+status,{id,verifier:str(verifier)});return J({ok:true});
});
on('GET','reservations/:id',async(_,id)=>{await sweep();const r=await view(id);return r?J(r):J({error:'Not found'},404)});
on('POST','reservations/:id',async(_,id)=>{
  const r=await (await col('reservations')).findOneAndUpdate({_id:String(id),status:{$in:['held','confirmed']}},{$set:{status:'released',closed_at:new Date()}});
  if(r)await (await col('beds')).updateOne({_id:r.bed_id,status:'reserved'},{$set:{status:'available',updated_at:new Date()}});
  const v=await view(id);return v?J(v):J({error:'Not found'},404);
});
