import {MongoClient,ObjectId} from 'mongodb';
export {ObjectId};

// One cached connection per serverless instance (reused across requests).
export function db(){
  if(!globalThis._bedDb){
    const uri=process.env.MONGODB_URI;
    if(!uri)return Promise.reject(new Error('MONGODB_URI is not set'));
    globalThis._bedDb=new MongoClient(uri,{maxPoolSize:5,serverSelectionTimeoutMS:8000}).connect()
      .then(async c=>{const d=c.db(process.env.MONGODB_DB||'bedagent');await indexes(d);return d})
      .catch(e=>{globalThis._bedDb=null;throw e});
  }
  return globalThis._bedDb;
}
const indexes=d=>Promise.all([
  d.collection('users').createIndex({email:1},{unique:true}),
  d.collection('hospitals').createIndex({reg_no:1},{unique:true}),
  d.collection('beds').createIndex({hospital_id:1,label:1},{unique:true}),
  d.collection('beds').createIndex({hospital_id:1,bed_type:1,status:1}),
  d.collection('reservations').createIndex({hospital_id:1,status:1}),
  d.collection('reservations').createIndex({phone_digits:1,status:1}),
  d.collection('reservations').createIndex({status:1,expires_at:1}),
  d.collection('reservations').createIndex({created_at:-1}),
  d.collection('rate_limits').createIndex({k:1,w:1},{unique:true}),
  d.collection('rate_limits').createIndex({ts:1},{expireAfterSeconds:172800}),
  d.collection('otps').createIndex({expires_at:1},{expireAfterSeconds:0}),
  d.collection('audit').createIndex({ts:-1})]);

export const J=(d,s=200)=>Response.json(d,{status:s});
export const oid=s=>/^[a-f\d]{24}$/i.test(String(s||''))?new ObjectId(String(s)):null;
// Mongo document -> JSON for the browser (_id becomes id)
export const pub=d=>{if(!d)return d;const{_id,...r}=d;return{id:String(_id),...r}};

// Serverless has no background timers, so expired holds are released lazily on every read.
// Response window (held) and arrival window (confirmed) both lapse; the bed returns to the pool.
export async function sweep(){
  const d=await db(),now=new Date(),R=d.collection('reservations');
  const old=await R.find({status:{$in:['held','confirmed']},expires_at:{$lt:now}}).limit(200).toArray();
  for(const r of old){
    const u=await R.updateOne({_id:r._id,status:r.status},{$set:{status:'expired',closed_at:now,decline_reason:r.status==='held'?'No response from hospital':'Patient did not arrive in time'}});
    if(u.modifiedCount)await d.collection('beds').updateOne({_id:r.bed_id,status:'reserved'},{$set:{status:'available',updated_at:now}});
  }
}

export async function audit(actor,action,detail){
  try{await (await db()).collection('audit').insertOne({ts:new Date(),actor,action,detail})}catch{}
}

// Fixed-window rate limit per IP. True if the caller exceeded `max` requests in `sec` seconds.
export const ip=r=>(r.headers.get('x-forwarded-for')||'local').split(',')[0].trim();
export const tooMany=()=>J({error:'Too many requests. Please wait a few minutes and try again.'},429);
export async function limited(req,name,max,sec,extra=''){
  const w=Math.floor(Date.now()/1000/sec),f={k:`${name}:${ip(req)}${extra}`,w},d=await db();
  const go=()=>d.collection('rate_limits').findOneAndUpdate(f,{$inc:{n:1},$setOnInsert:{ts:new Date()}},{upsert:true,returnDocument:'after'});
  let r;try{r=await go()}catch(e){if(e.code!==11000)throw e;r=await go()}
  return (r?.n||1)>max;
}
