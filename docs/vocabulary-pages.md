# Vocabulary webpages

In the vocabulary builder's publishing section, expand **Add webpage**, enter the webpage creation password, a page name, and a publishing password, and choose **Create webpage**. The saved page is selected immediately and appears in the dropdown on subsequent visits, including other browsers. Its link opens a vocabulary library with the chosen name. Publishing and removing sets require that page's password; studying does not.

The existing sixth, seventh, and eighth grade URLs and `CARD_PUBLISH_KEY_SIXTH`, `CARD_PUBLISH_KEY_SEVENTH`, and `CARD_PUBLISH_KEY_EIGHTH` settings remain supported.

## Storage and deployment

Deploy the updated static files, both publishing API files, and `lib/vocabulary-pages.js` together. The feature uses the existing Vercel Blob store and its `BLOB_READ_WRITE_TOKEN`. It does not need a separate HTML file or deployment for each newly created page.

Page records live at `vocabulary-pages/<id>.json`. Names are public. Passwords are never stored in plaintext; records hold a server-keyed HMAC verifier, bound to the page ID. Listing and publishing API responses expose only the page ID, name, and URL.

The verifier key is `VOCABULARY_PAGE_SECRET` when set, otherwise the existing `BLOB_READ_WRITE_TOKEN`. Keep this key stable. To rotate the Blob token after creating pages with the default, first set `VOCABULARY_PAGE_SECRET` to the old token value so existing publishing passwords continue to work. An optional dedicated secret should be set before creating the first custom page and shared by deployments that use the same page store.

Creating a page requires the administrator's webpage creation password. The API verifies a salted scrypt hash before accessing page storage. The requested initial password is supported by the default hash; deployments can override it with the server-only `VOCABULARY_PAGE_CREATE_PASSWORD` environment variable. This credential is separate from each page's publishing password and is not included in browser assets, stored page records, or API responses. Existing pages cannot be overwritten by creation, including simultaneous requests for the same name. Password reset, renaming, and page deletion are not included in this change.

## Verification

Run `node --test tests/study-cards.test.js tests/vocabulary-pages.test.js`. The tests use isolated in-memory Blob storage and cover persisted listings, duplicate/concurrent creation, Unicode names and passwords, publishing, viewing, deletion, authorization boundaries, legacy grades, and storage failures.
