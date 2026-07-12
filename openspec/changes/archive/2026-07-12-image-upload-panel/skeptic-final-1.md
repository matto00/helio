## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ticket AC traceability** (`openspec/changes/image-upload-panel/ticket.md`):
   - `POST /api/uploads/image` accepts multipart, validates MIME/extension, persists via `FileSystem`,
     returns `{id, url}` — confirmed in `backend/src/main/scala/com/helio/api/routes/UploadRoutes.scala`
     and `ImageUploadService.upload` (`backend/src/main/scala/com/helio/services/ImageUploadService.scala:46-72`).
   - `GET /api/uploads/image/<id>` serves bytes with correct content-type — confirmed in
     `PublicUploadRoutes.scala`.
   - Image panel config UI gets an "Upload" button — confirmed in `ImageEditor.tsx:118-133` and visually
     verified live (screenshots below).
   - URL stored on panel like any other imageUrl (no separate panel-content storage) — confirmed;
     `ImageEditor` sets `imageUrl` state directly and persists via the existing `updatePanelImage` thunk.
   - `FileSystem` reused (no direct `java.nio.file`) — confirmed, `ImageUploadService` takes a
     `FileSystem` and calls only `.write`/`.read`.
   - 10 MB size limit, configurable — confirmed via `IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES` env var default
     `10485760L` in both the route (fast-reject) and service (authoritative), matching the existing
     four-connector pattern.
   - Non-image MIME rejected at route level — actually rejected in the **service** layer via
     `ContentSourceSupport.validateExtension`, invoked from the route handler before any `FileSystem.write`
     — functionally satisfies "before any bytes are written," which is what the spec's scenario actually
     requires (`specs/image-upload/spec.md` lines 19-29).
   - Docs in `notes/uploads-filesystem-layout.md` — present, accurate, cross-references the `image/` vs
     `images/` prefix distinction correctly.
   - Tests cover upload/serve/size-limit/MIME-reject — confirmed, ran them myself (below).

2. **GET unauthenticated wiring** — read `ApiRoutes.scala` diff directly: `PublicUploadRoutes` is
   mounted inside `authDirectives.optionalAuthenticate { ... concat(PublicDashboardRoutes, imageUploadServiceOpt...) }`,
   i.e. genuinely unauthenticated, exactly as designed. Confirmed live via `curl` with no `Authorization`
   header → `200 OK` with correct bytes; unknown id → `404`; `POST` without auth → `401`.
   No directory traversal: the GET id only participates in an exact-match SQL lookup
   (`ImageUploadRepository.findById`, `uploads.filter(_.id === id.value)`) — the actual filesystem read
   uses the DB-stored `storage_key`, never the raw path segment, so a crafted id can at most miss the
   DB lookup (404). Verified empirically: `curl .../uploads/image/..%2f..%2f..%2fetc%2fpasswd` → `404`,
   `curl .../uploads/image/....//....//etc/passwd` → `404`.

3. **WebP MIME derivation does not go through ImageIO** — read `ImageUploadService.scala` in full:
   `mimeTypeByExtension` is a static literal map; `upload()` never calls `ImageIO`/`ImageSourceSupport`.
   Proved this is not just superficial: generated a **genuine** WebP file with Python PIL
   (`file` confirmed `RIFF ... Web/P image, VP8 encoding`), uploaded it directly to the running backend
   via `curl -F file=@test-upload.webp` with a real Bearer token → `201 Created`; fetched it back
   unauthenticated → `200 OK`, `Content-Type: image/webp`, byte-identical to the original (`diff` confirmed
   identical). Then set that returned URL as the Image panel's `imageUrl` through the actual UI and
   confirmed the correct solid-color (RGB 0,200,120) image rendered on screen (screenshot). This is a
   real end-to-end proof, not just an absence-of-ImageIO code read. Also ran `UploadRoutesSpec`'s own
   `.webp` case (uses non-decodable filler bytes, which would fail any real ImageIO decode attempt) —
   passed, confirming the regression-proof nature of that test.

4. **RLS on `image_uploads`**: read `V54__image_uploads.sql` — `ENABLE`/`FORCE ROW LEVEL SECURITY` +
   direct-owner policy present. `RlsPolicyGuardSpec.scala` diff adds `"image_uploads"` to the `rlsTables`
   allowlist. `RlsOwnerTablesSpec.scala` diff adds three real tests seeding via
   `ImageUploadRepository.insert` (the actual write path, not raw SQL) and asserting owner isolation
   under `withUserContext` plus full visibility under `withSystemContext`. Ran both specs myself:
   `sbt "testOnly com.helio.infrastructure.RlsPolicyGuardSpec com.helio.infrastructure.RlsOwnerTablesSpec"`
   → 51/51 passed, including the 3 new `image_uploads` RLS tests.

5. **`ImagePanel.tsx` sanitizeImageUrl`** — reads `new URL(url, window.location.origin)`, accepts both
   absolute `http(s)://` and root-relative `/api/uploads/image/<id>` (guarding against
   protocol-relative/backslash-smuggled `//evil.com` by requiring `parsed.origin === window.location.origin`
   for the raw-string branch). Ran the full frontend Jest suite for the touched files:
   `npx jest --testPathPatterns="ImagePanel|ImageEditor|PanelDetailModal"` → 93/93 passed across 6 suites.
   Live-verified in browser: pre-existing uploaded red PNG rendered correctly via its stored
   `/api/uploads/image/<id>` URL in both dark and light theme; my own freshly-uploaded WebP (green)
   rendered correctly after setting the same URL through the UI form and saving. No console errors
   (`browser_console_messages` → 0 errors, 1 pre-existing warning unrelated to this change).

6. **Scope boundary (no HEL-245 bleed)**: grepped the diff and the touched Image-panel files for
   "markdown" — no hits. `git diff main...HEAD --stat` shows changes confined to upload routes/service/
   repo/migration, `ImageEditor.tsx`/`ImagePanel.tsx`/`PanelDetailModal.css`, `panelService.ts`, docs, and
   OpenSpec artifacts — no Markdown-panel files touched.

7. **Design-standard (DESIGN.md) spot-check**: `PanelDetailModal.css` additions use only design tokens
   (`--space-2/3`, `--app-border-subtle/strong`, `--app-radius-sm`, `--control-md` (confirmed defined in
   `theme.css:60` and reused elsewhere), `--text-xs`, `--weight-medium`, `--app-transition`, `--app-accent`) —
   no hardcoded colors/sizes found. Visually confirmed light/dark parity of the new Upload button via
   screenshots in both themes — consistent secondary-button treatment matching sibling controls.

8. **Backend test run** (fresh, this session): `sbt "testOnly com.helio.api.UploadRoutesSpec"` → 12/12
   passed (all 5 extensions incl. webp, missing-file, bad-extension, oversized, at-limit, unauthenticated
   POST, GET valid/unknown-id).

9. **Lint**: `npx eslint` on the three touched frontend files → clean, zero warnings.

### Verdict: CONFIRM

### Non-blocking notes
- The spec text says non-image MIME types are rejected "at the route level" but the actual rejection
  happens one layer down in `ImageUploadService.upload` (called from the route). Functionally identical
  (no bytes are ever written to `FileSystem` on rejection, and the route is a thin wrapper that
  immediately awaits the service call) — not a real divergence, just a wording nit in the spec vs. the
  layered implementation. Not blocking.
- `ImageEditor`'s inline `ACCEPTED_UPLOAD_EXTENSIONS` constant is manually kept in sync with the backend's
  `allowedExtensions` set rather than fetched/shared — acknowledged in a code comment as a deliberate
  trade-off; fine for this scope, worth a shared-constant refactor if a third consumer appears.
