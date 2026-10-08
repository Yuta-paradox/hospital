// Sends verification emails through Resend (https://resend.com, free tier). Any provider can replace this one function.
// No RESEND_API_KEY: in development the code is only printed to the server log; in production sending is refused.
export async function sendMail(to,subject,text){
  const k=process.env.RESEND_API_KEY;
  if(!k){if(process.env.NODE_ENV==='production')throw new Error('MAIL_NOT_CONFIGURED');console.log('[dev mail]',to,subject,text);return{dev:true}}
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+k,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM||'Bed Coordination <onboarding@resend.dev>',to:[to],subject,text}),signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error('MAIL_FAILED');return{};
}
