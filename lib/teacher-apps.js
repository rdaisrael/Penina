const APPS = [
    {id:'reader',name:'Penina Hebrew Reader',url:'/PeninaPlus-Reader/'},
    {id:'vocabulary',name:'Penina Vocabulary Builder',url:'/PeninaPlus-vocab-builder/'},
    {id:'binyan',name:'Penina Binyan Builder',url:'/PeninaPlus-Binyan-Builder/'},
    {id:'quizzes',name:'Penina Quizzes',url:'/Penina-Quizzes/teacher/'}
];
function appsFor(teacher) {
    // Existing accounts predate per-app access; preserve their previous access.
    return teacher.userId===1 || teacher.apps===undefined ? APPS.map(app=>app.id) : APPS.filter(app=>teacher.apps.includes(app.id)).map(app=>app.id);
}
function validateApps(value) {
    if(!Array.isArray(value) || value.some(id=>!APPS.some(app=>app.id===id)))
        throw Object.assign(Error('Choose access using the webapp checkboxes.'),{status:400});
    return [...new Set(value)];
}
async function requireApps(req, allowed) {
    const user=require('./quiz-account').session(req);
    if(user.role!=='teacher')throw Object.assign(Error('Sign in with your registered teacher account.'),{status:403});
    const teacher=await require('./quiz-teachers').registered(user.email);
    if(!teacher || teacher.userId!==user.userId)throw Object.assign(Error('This teacher account is not active. Sign in again.'),{status:403});
    if(teacher.mustChangePassword && user.authMethod!=='google')throw Object.assign(Error('Sign in on Penina Home and change your temporary password before opening apps.'),{status:403});
    if(!allowed.some(id=>appsFor(teacher).includes(id)))throw Object.assign(Error('You do not have access to this webapp. Ask David Israel for access.'),{status:403});
    return teacher;
}
module.exports={APPS,appsFor,validateApps,requireApps};
