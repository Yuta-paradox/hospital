// Demo data only: 3 verified Jaipur hospitals, beds and demo logins. Do NOT run against production.
import {MongoClient} from 'mongodb';import bcrypt from 'bcryptjs';
if(!process.env.MONGODB_URI){console.error('Set MONGODB_URI in .env.local');process.exit(1)}
const c=await new MongoClient(process.env.MONGODB_URI).connect(),d=c.db(process.env.MONGODB_DB||'bedagent'),pw=await bcrypt.hash('Demo@12345',10),now=new Date();
// [name, reg no, type, address, lat, lng, phone, level, facilities, key, [[bedType, prefix, count, free, oxygen, ventilator, monitor]]]
const H=[['City General Hospital','RJ/GOV/2011/0412','Government','JLN Marg',26.9055,75.816,'0141-2000001',3,['trauma','cardiac'],'a',[['ICU','ICU',6,0,1,1,1],['HDU','HDU',4,2,1,0,1],['ER','ER',8,3,1,0,0],['TRAUMA','TRM',4,1,1,0,1]]],
 ['St. Mary Medical Centre','RJ/PVT/2015/0873','Private','Tonk Road',26.8505,75.8043,'0141-2000002',2,[],'b',[['ICU','ICU',5,2,1,1,1],['ER','ER',6,4,1,0,0],['GENERAL','GEN',10,5,0,0,0],['PEDIATRIC','PED',6,3,1,0,0]]],
 ['Northside Trauma Institute','RJ/PVT/2018/1290','Private','Civil Lines',26.9239,75.8267,'0141-2000003',3,['trauma','cardiac','neuro'],'c',[['ICU','ICU',4,1,1,1,1],['ER','ER',6,2,1,0,0],['HDU','HDU',4,1,1,0,1],['NICU','NICU',4,2,1,1,1]]]];
await d.collection('hospitals').createIndex({reg_no:1},{unique:true});await d.collection('users').createIndex({email:1},{unique:true});await d.collection('beds').createIndex({hospital_id:1,label:1},{unique:true});
for(const[name,reg_no,type,address,lat,lng,tel,lvl,fac,k,beds]of H){
  if(await d.collection('hospitals').findOne({reg_no})){console.log('skip',name);continue}
  const{insertedId:hid}=await d.collection('hospitals').insertOne({name,reg_no,type,address,city:'Jaipur',state:'Rajasthan',pincode:'302001',lat,lng,phone:tel,emergency_phone:tel,facilities:fac,emergency_level:lvl,status:'verified',website:'https://demo.example.org',licence_valid_till:new Date(Date.now()+3*365*864e5),mc_reg_no:'DEMO-MC-0001',emergency_phone_digits:tel.replace(/\D/g,''),verification:{checks:{reg_matches:true,callback_done:true,location_ok:true,email_ok:true},verifier:'seed',note:'demo data',at:now},auto:{email_domain_matches_website:true,near_duplicate:null},last_confirmed_at:now,created_at:now});
  await d.collection('users').insertMany([{hospital_id:hid,name:'Demo Administrator',designation:'Medical Superintendent',email:`admin.${k}@demo.test`,password_hash:pw,role:'admin',email_verified:true,created_at:now},{hospital_id:hid,name:'Demo Staff',designation:'Casualty Nurse',email:`staff.${k}@demo.test`,password_hash:pw,role:'staff',email_verified:true,created_at:now}]);
  for(const[t,pre,n,fr,o2,vent,mon]of beds)await d.collection('beds').insertMany(Array.from({length:n},(_,i)=>({hospital_id:hid,bed_type:t,label:`${pre}-${String(i+1).padStart(2,'0')}`,ward:t+' ward',floor:'1',status:i<fr?'available':'occupied',has_oxygen:!!o2,has_ventilator:!!vent,has_monitor:!!mon,isolation:false,gender:'any',updated_at:now})));
  console.log('seeded',name)}
console.log('Demo logins: admin.a@demo.test / staff.a@demo.test (also b, c). Password: Demo@12345');await c.close();
