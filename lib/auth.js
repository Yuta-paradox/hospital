import {SignJWT,jwtVerify} from 'jose';import bcrypt from 'bcryptjs';import {cookies} from 'next/headers';
const key=()=>new TextEncoder().encode(process.env.AUTH_SECRET);
export const hash=p=>bcrypt.hash(p,10);export const check=(p,h)=>bcrypt.compare(p,h);
export async function setSession(u){const t=await new SignJWT({uid:u.id,hid:u.hospital_id,role:u.role}).setProtectedHeader({alg:'HS256'}).setExpirationTime('12h').sign(key());
 cookies().set('s',t,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:43200})}
export async function session(){try{const t=cookies().get('s')?.value;return t?(await jwtVerify(t,key())).payload:null}catch{return null}}
