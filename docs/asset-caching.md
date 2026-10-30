# Browser updates across Penina

Every deployment runs `npm run build` (configured in `vercel.json`). This local build step versions the site's own JavaScript and CSS references using a hash of each file's contents. It covers public HTML, scripts loaded dynamically through root-relative literal URLs, and scripts injected by the authenticated page gateway. Third-party CDN URLs, images, fonts, and user-facing page/Classroom URLs are unchanged.

Changed dependencies also change their loader's hash. Unchanged assets keep the same version. Existing hand-written `?v=` values are replaced automatically. The generated `lib/asset-manifest.json` is included in the server function so its injected scripts use the same versions as static pages. The checked-in manifest is empty for unbuilt local development.

Static HTML (including directory and extensionless page URLs), JS, and CSS use `Cache-Control: public, no-cache`: browsers may store them, but must validate before reuse. Unchanged responses can use a small 304 response instead of downloading the file. This also covers relative dynamic URLs not rewritten by the build. Authenticated pages and APIs retain their existing private/no-store handling. No script reloads open pages or clears student work, storage, cookies, or sign-ins.

The build rewrites HTML and dependent JS in the build checkout. Do not commit its generated version changes or manifest. To test without changing working source, run `node --test tests/asset-versioning.test.js tests/teacher-apps.test.js`; the tests build all public assets in temporary directories. Source files remain unversioned; future deployments generate versions automatically. No deployment happens as part of these tests.

New public directories and HTML/JS/CSS files are discovered automatically. Hidden folders, archives, dependencies, backend code, tests, docs, and build tooling are excluded. Vendored libraries are hashed without rewriting their internals. Circular literal asset dependencies fail the build before writing files. Relative dynamic script URLs remain supported through revalidation; prefer root-relative literal URLs for automatic versioning.

Once deployed, the change applies on the next page request or normal reload. A tab already open keeps its current code until reloaded. A browser that already considers an old HTML response fresh may need one final reload to receive the new cache policy; a new server policy cannot retroactively change an already-cached response's headers.
