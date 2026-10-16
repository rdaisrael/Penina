# Teacher entrance

Open `/Penina-Quizzes/teacher/` from Teacher tools on the Penina home page. User 1 signs in with the registered school email and teacher account password, then authorizes the same Google account. The server verifies the password with a salted scrypt verifier and binds the OAuth callback to that email. The plaintext password is not stored in the repository or browser. Existing Google subject IDs continue to own quizzes, assignments, and submissions.

The home page has two choices: **Write & assign quizzes** opens the library/builder and class assignment controls; **Correct quizzes** lists the signed-in teacher’s stored Classroom assignments with a class filter. Classroom drafts are identified. Imported quizzes remain accessible in both areas. Review links select the relevant class; older imported results are filtered by the stored class ID.

Assignment pages can create/open a Classroom draft and explicitly publish it to students. Publishing verifies the stored assignment, teacher membership, active class, developer ownership, and maximum points. Review pages retain corrections, CSV export, and server-calculated grade transfer. User 1’s authenticated session authorizes imported quiz reports without repeated grade passwords. Vocabulary publishing passwords are unchanged.

The new entrance uses the existing Google OAuth scopes and encrypted 24-hour session cookie. It requires no new environment variables. Google can still require renewed consent. The server verifier is deliberately under the existing blocked `/lib/quiz*` route. Rotate the verifier to change the teacher account password; never place plaintext credentials in static files.

Validation: `node --test tests/*.test.js`. Local browser preview uses simulated Classroom responses; real Google consent, assignment publication, and grade transfer must be checked after deployment with the teacher account.
