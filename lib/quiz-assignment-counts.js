'use strict';
const {createStorage,failureDetails}=require('./quiz-submission-storage');

async function addSubmissionCounts(assignments,owner) {
    const quizzes=new Map();
    for(const assignment of assignments) {
        if(assignment.state==='DRAFT')continue;
        if(!quizzes.has(assignment.quiz))quizzes.set(assignment.quiz,[]);
        quizzes.get(assignment.quiz).push(assignment);
    }
    // Read each quiz once, even when it is assigned to several classes.
    for(const [quizId,items] of quizzes) {
        const context={quizId,action:'assignment-counts'};
        const ungraded=items[0].gradingMode==='ungraded',countField=ungraded?'unreviewedCount':'ungradedCount';
        try {
            let grade;
            if(quizId.startsWith('custom-')) {
                const quiz=await require('./quiz-builder').published(quizId);
                if(quiz.owner!==owner)throw Error('Only the author can review this quiz.');
                grade=(answers,correction)=>require('./quiz-builder-model').grade(quiz,answers,correction);
            } else if(quizId==='gemara-6-wl-2')grade=require('./quiz-grading').grade;
            else if(['gemara-6-intro-retake','gemara-8-intro-retake'].includes(quizId))grade=require('./quiz-retake-grading').grade;
            else throw Error('Unknown quiz.');
            const {readRecords}=createStorage(quizId);
            const [records,corrections,reviews]=await Promise.all([
                readRecords('quiz-submissions/'+quizId+'/',context),
                readRecords('quiz-corrections/'+quizId+'/',context),
                ungraded?readRecords('quiz-reviews/'+quizId+'/',context):[]
            ]);
            const reviewed=new Set(reviews.filter(review=>review.reviewedAt).map(review=>review.id));
            const latest=new Map();
            for(const correction of corrections) {
                if(!latest.has(correction.id) || latest.get(correction.id).savedAt<correction.savedAt)latest.set(correction.id,correction);
            }
            const counts=new Map(items.map(item=>[item.classId,0]));
            for(const record of records) {
                if(!counts.has(record.classId))continue;
                const grading=grade(record.answers,latest.get(record.id));
                // Match the saved, complete corrections required by the roster's Graded check.
                const needsAttention=ungraded?!reviewed.has(record.id) && !grading.savedAt:!grading.savedAt || grading.pending!==0;
                if(needsAttention)counts.set(record.classId,counts.get(record.classId)+1);
            }
            for(const item of items)item[countField]=counts.get(item.classId);
        } catch(error) {
            // Keep assignments usable, and never present a failed read as zero work remaining.
            for(const item of items)item[countField]=null;
            console.error('Quiz assignment counts failed:',failureDetails(error,context,'assignment-counts'));
        }
    }
}

module.exports={addSubmissionCounts};
