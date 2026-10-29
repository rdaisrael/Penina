const crypto=require('crypto');
const {APPS,appsFor}=require('./teacher-apps');
async function sendWelcome(teacher, {resend=false}={}) {
    const from=process.env.QUIZ_EMAIL_FROM || process.env.LIVE_SCORE_EMAIL_FROM;
    if(!process.env.RESEND_API_KEY || !from)throw Error('Email service is not configured.');
    const apps=APPS.filter(app=>appsFor(teacher).includes(app.id));
    const text=[`Hello ${teacher.name},`,'','Your Penina teacher account is ready.',`Teacher number: ${teacher.userId}`,`School email: ${teacher.email}`,'','Sign in at https://www.penina-hebrew.org/ using Google or choose "Sign in with another email address" to receive a secure sign-in link. Use your registered email address.','No separate Penina password is needed.','',apps.length?'You have access to:':'No webapps have been assigned yet. Contact David Israel for access.',...apps.map(app=>`• ${app.name}`),'','After signing in, you will land directly on the Penina home page, where you can choose from your available apps: https://www.penina-hebrew.org/'].join('\n');
    const payload={from,to:[teacher.email],subject:'Welcome to Penina',text};
    const key=resend?crypto.randomUUID():crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    let response;
    try { response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'teacher-welcome-'+key},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)}); }
    catch (_) {throw Error('The welcome email could not be sent. Please retry.');}
    if(!response.ok)throw Error('The email service did not accept the welcome email. Please retry.');
    return {status:'accepted',to:teacher.email};
}
module.exports={sendWelcome};
