const crypto=require('crypto');
const {APPS,appsFor}=require('./teacher-apps');
async function sendWelcome(teacher, {resend=false}={}) {
    const from=process.env.QUIZ_EMAIL_FROM || process.env.LIVE_SCORE_EMAIL_FROM;
    if(!process.env.RESEND_API_KEY || !from)throw Error('Email service is not configured.');
    const apps=APPS.filter(app=>appsFor(teacher).includes(app.id));
    const text=[
        `Hello ${teacher.name},`,'','Your Penina teacher account is ready.',
        `Teacher number: ${teacher.userId}`,`Registered email: ${teacher.email}`,'',
        'Visit https://www.penina-hebrew.org/ and choose either sign-in option. Always use your registered email address.','',
        'Option 1: Sign in with Google',
        'If your registered email address has a Google account, including a school Google Workspace account, click "Sign in with Google" and choose that account. You do not need to use or change a Penina password.','',
        'Option 2: Sign in with a Penina password',
        ...(teacher.mustChangePassword?[
            `Temporary password: ${teacher.temporaryPassword}`,
            'Enter your registered email address and this temporary password in the Sign in form. The first time you use this method, you must replace the temporary password before accessing your apps. Choose a new password between 12 and 128 characters.'
        ]:['Enter your registered email address and the Penina password you chose. Your existing password has not changed.']),
        'Your Penina password is separate from your Google password. Changing your Penina password does not change your Google password.',
        'If you need help signing in, contact David Israel.','',
        apps.length?'You have access to:':'No webapps have been assigned yet. Contact David Israel for access.',
        ...apps.map(app=>`• ${app.name}`),'',
        'After completing sign-in and any required Penina password change, you will land directly on the Penina home page, where you can choose from your available apps: https://www.penina-hebrew.org/'
    ].join('\n');
    const payload={from,to:[teacher.email],subject:'Welcome to Penina',text};
    const key=resend?crypto.randomUUID():crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    let response;
    try { response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'teacher-welcome-'+key},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)}); }
    catch (_) {throw Error('The welcome email could not be sent. Please retry.');}
    if(!response.ok)throw Error('The email service did not accept the welcome email. Please retry.');
    return {status:'accepted',to:teacher.email};
}
module.exports={sendWelcome};
