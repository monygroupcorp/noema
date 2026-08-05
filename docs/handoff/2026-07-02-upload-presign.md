# Handoff — Crystal upload / presign endpoint (JS-nuke blocker #10)

**For:** a fresh-context agent. **Goal:** give crystal an input-media upload path so the React web
app can upload files (i2i input images + profile avatar/banner) directly to R2, and `/v1/runs` can
receive uploaded images. Today crystal has **no upload/presign endpoint** — the web app's
`signUpload` 404s and image-to-image on web is broken. This gates the legacy-JS teardown.
Context: `docs/plans/2026-07-02-js-nuke-readiness.md` blocker #10.

## Ground rules
- **Crystal TypeScript only.** Read the legacy JS for behavior, re-express — do not import it.
- End green: `npx tsc --noEmit`, `npm run test:crystal`/`test:hermetic`, docs-drift gate. No `Co-Authored-By`. Prefer `fix:`.

## The exact gap (verified 2026-07-02)
- The web app calls `POST /api/v1/storage/uploads/sign` with body `{ filename, contentType, bucketName? }`
  — `src/platforms/web/app/src/lib/api.ts:146`. Used by `uploadAsset` in
  `src/platforms/web/app/src/screens/Profile.tsx` (avatar/banner: presign → PUT to R2), and needed
  for i2i input images.
- **No handler exists** and it is not proxied: `/api/v1/*` is served by
  `createAgentCompatRouter` (`src/index.ts:922`), which has no storage route; the SPA catch-all
  `next()`s `/api` and `/v1` rather than forwarding to legacy.
- `POST /v1/runs` (`CrystalApi.createRun`) takes `aditus` as plain values — **image ports must be
  pre-hosted URLs** today. There is no upload step.
- `R2Uploader` (`src/crystal/R2Uploader.ts`) implements `ObjectStore` — `put`/`putStream`/`del`
  (interface at `:15`/`:26`, class `:38`) — but has **no `getSignedUrl`/presign**. It's an
  S3-compatible client (R2 endpoint `…r2.cloudflarestorage.com`, `accessKeyId`/`secretAccessKey`/
  `bucket`/`publicUrl` wired at `src/index.ts:208`).
- Telegram i2i is fine and unaffected (`TelegramAllocutio._resolveFileUrl`→`getFileLink`).

## Legacy contract to reproduce
Read `git show main:src/api/external/storage/storageApi.js` (routes `/storage/upload`,
`/storage/upload-url`, `/storage/uploads/sign`) and `git show main:src/api/external/upload/uploadApi.js`
(`/upload/image(s)`) for the exact request/response shapes. The presign shape is the important one.

## Build
1. **Add presign to the object store.** Add `getSignedUploadUrl(key, contentType, opts?)` to the
   `ObjectStore` interface + `R2Uploader` (`src/crystal/R2Uploader.ts`), using the S3 SDK's
   `getSignedUrl` (PutObject, short TTL e.g. 5 min). Return `{ uploadUrl, publicUrl }` where
   `publicUrl = <R2_PUBLIC_URL>/<key>`. Key convention: namespace by owner + purpose, e.g.
   `uploads/<AuctorKey-hash>/<uuid>.<ext>` and `avatars/<…>` — mirror the `models/<id>/<file>`
   convention already used by `trainingFinalizer`.
2. **Add a storage router.** `createStorageRouter({ store })` exposing
   `POST /storage/uploads/sign` → validate `{ filename, contentType }` (allowlist content-types:
   image/png|jpeg|webp; reject others), derive a safe key, return
   `{ uploadUrl, publicUrl, key }`. Scope the key to the caller's `AuctorKey` (reuse the `/v1`
   `auth()` helper so anon `x-commitment` users get owner-scoped keys). Optionally add a direct
   `POST /storage/upload` (multipart → `store.put`) for non-presign clients.
3. **Mount at BOTH the compat and native paths.** The web app calls `/api/v1/storage/*` today, so
   mount there (beside `createAgentCompatRouter`, `src/index.ts:922`) AND expose the native
   `/v1/storage/*` for new callers. (Cheapest: one router, two `app.use` mounts.)
4. **Wire it in `container.ts`/`src/index.ts`** with the existing R2 config (`src/index.ts:208`).

## Acceptance
- `POST /api/v1/storage/uploads/sign {filename,contentType}` → `{uploadUrl,publicUrl}`; a browser
  `PUT` of image bytes to `uploadUrl` succeeds; `GET publicUrl` returns the image.
- `Profile.tsx` avatar/banner upload works end-to-end against crystal (no 404).
- An i2i run: upload an input image → pass `publicUrl` as the image `aditus` on `POST /v1/runs` →
  the flow consumes it. (URL-only aditus still works; upload is the new front door.)
- Non-image content-types are rejected; keys are owner-scoped.
- `tsc`, `test:crystal`, `test:hermetic` green; a hermetic test for the presign router (mock store).

## Pointers
- `src/crystal/R2Uploader.ts` (add presign), `src/index.ts:208` (R2 config), `:922` (compat mount).
- `src/platforms/web/app/src/lib/api.ts:146` (`signUpload`), `screens/Profile.tsx` (`uploadAsset`).
- `src/allocutio/api/apiRouter.ts` `auth()` (owner-scoping), `CrystalApi.createRun` (aditus).
- Legacy: `git show main:src/api/external/storage/storageApi.js`, `.../upload/uploadApi.js`.
- Memory: `project_js_nuke_readiness`.
