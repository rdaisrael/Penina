# Penina video library and viewer

The initial video Worker and library hostname are deployed. The standalone viewer, clipboard control on the library, and clearer upload instructions described below are local changes and have not been published yet.

## Intended flow

1. David opens the Penina homepage, chooses **Teacher sign-in** in the upper right, and signs in. His **My videos** panel appears below the app cards. He uploads an MP4 there. The existing signed Penina session is verified server-side; only David can list or upload from this panel.
2. The video is stored in the `penina-video-test` R2 bucket. Its title and upload details are kept as object metadata.
3. The public library at `https://video.penina-hebrew.org/` lists the uploaded video and displays its viewer address.
4. The viewer address opens a standalone Penina webpage with native playback controls and starts playback after the page finishes loading. David can copy the exact viewer URL from **My videos** and paste it into a Google Classroom assignment. Students open the viewer page and stream the video there.

To add a video, enter a title, choose an MP4 up to 1 GB, and select **Upload video**. Keep the homepage open until the upload completes. Its standalone viewer URL then appears in **My videos** and in the public library automatically. Select the clipboard icon beside the viewer URL to copy it for Google Classroom.

The library and viewer pages are public. Anyone can browse the library or watch a listed video. Do not upload student records or videos that should be private. Direct R2 access is not needed; the Worker reads media through its bucket binding and supports byte ranges for seeking.

## Cloudflare connection needed before publishing

Cloudflare currently has `video.penina-hebrew.org` connected directly to R2 as a custom domain. A Worker custom domain cannot be added while that hostname's existing R2 CNAME is present. The Worker must replace the R2 domain connection so the hostname can serve the library and viewer pages.

For an authorized rollout:

1. Deploy the Worker with the existing `www.penina-hebrew.org/videos/*` route and the `VIDEOS` binding to `penina-video-test`.
2. In the R2 bucket settings, remove the `video.penina-hebrew.org` custom-domain connection. This removes the direct R2 hostname while the Worker domain is being attached.
3. Deploy the Worker configuration with the `video.penina-hebrew.org` custom domain enabled. Cloudflare will attach the hostname to the Worker. Do not re-add it as an R2 custom domain.
4. Confirm the homepage upload panel is available to David and the video library/viewer pages work before sharing viewer links.

The `www.penina-hebrew.org/videos/*` route is used only for the authenticated upload/list API. The `video.penina-hebrew.org` Worker custom domain serves the public catalog, viewer pages, and range-enabled media responses. `workers_dev` and preview URLs are disabled.

The bucket currently contains a test MOV at its root. The catalog includes supported video files in the bucket root as well as managed uploads, so that test appears in the library after the Worker takes over the video hostname. The upload panel accepts MP4 with H.264 video and AAC audio for broad browser support. MOV playback still depends on each browser's codec support; convert the test MOV to MP4 if it does not play in the target student browser.

## Storage and limits

- Uploads are sent in 8 MiB parts, with a 1 GiB per-file maximum.
- The Worker streams video from R2 and supports byte ranges, seeking, `HEAD`, and conditional requests.
- Upload bookkeeping is written under `uploads/`; keep the default multipart-abort rule and configure a lifecycle rule to remove abandoned `uploads/` records after two days. Do not expire objects under `videos/`.
- The homepage warns when stored videos approach the 10 GB R2 free storage allowance. That warning is not a billing cap; other R2 buckets, abandoned parts, and request usage count toward the account's usage.
- Cloudflare billing, DNS, bucket-domain changes, Worker publication, and live verification are separate from these local code changes. Follow the user's explicit deployment and live-check instructions before carrying them out.
