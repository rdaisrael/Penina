# Activate Penina Google sign-in and Classroom enrollment checks

This is a one-time setup. Client secrets belong in Vercel environment settings, never in source code, a browser URL, or a chat message.

1. Choose the Google Cloud project owned by the person or school responsible for Penina. Enable the Google Classroom API.
2. Configure Google Auth Platform branding and audience for Penina. If school-owned and limited to the school's Workspace organization, an Internal audience may be appropriate. Otherwise use the appropriate External configuration. While testing, configure permitted test users as required by Google. Schools may need to approve the OAuth app, and sensitive Classroom scopes may require Google verification before broader availability.
3. Register a Web application OAuth client with this exact authorized redirect URI:

   `https://www.penina-hebrew.org/api/game-scores?game=quiz-account&action=callback`

4. Add these Vercel Production environment variables:

   - `GOOGLE_CLASSROOM_CLIENT_ID`: the web OAuth client ID.
   - `GOOGLE_CLASSROOM_CLIENT_SECRET`: its secret.
   - Existing `BLOB_READ_WRITE_TOKEN` and `CARD_PUBLISH_KEY_SIXTH` must remain configured.
   - Keep the existing encryption secret stable; do not rotate it as part of this setup.

5. Deploy the tested changes. Teacher opens Penina → Quizzes → Teacher tools and connects their Google account. Teacher reviews and grants access to their classes and rosters, and permission to create assignments and update student grades. The requested scopes are:

   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/classroom.courses.readonly`
   - `https://www.googleapis.com/auth/classroom.rosters.readonly`
   - `https://www.googleapis.com/auth/classroom.coursework.students`

6. Choose a class and create its Classroom assignment draft. Open the draft in Classroom, review it, and publish it with 12 maximum points. Use this Penina-created assignment for grade transfer; assignments created through the old share dialog cannot receive API grades. Replace previously shared generic quiz links. Selecting a Google account in the old share dialog alone does not configure enrollment restrictions.
7. Verify with teacher-approved test accounts: an enrolled student can open the questions; an account outside the class cannot; a student removed from the roster is refused on the next protected request. Do not create permanent synthetic submissions in production without the teacher's approval.

Students request only `openid`, `email`, and `profile`; the teacher's encrypted refresh token supplies the roster-check permission. Penina requests permission to create coursework and modify student grades; it does not request permission to modify rosters. Existing teacher connections must reconnect to grant the new coursework scope. A real end-to-end test requires a school account enrolled as a student, a published Penina-created assignment, quiz submission, marking done in Classroom, teacher corrections, and a grade visible in the Classroom gradebook.

Useful Google documentation:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/classroom/guides/auth
- https://developers.google.com/workspace/classroom/reference/rest/v1/courses.students/get
