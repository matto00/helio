## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket/proposal/design/specs/tasks read in full** (`ticket.md`, `proposal.md`, `design.md`,
  `specs/image-upload/spec.md`, `specs/image-panel-type/spec.md`, `tasks.md`).

- **`FileSystem` abstraction claim** — `backend/src/main/scala/com/helio/infrastructure/FileSystem.scala`
  confirms the `write`/`read`/`delete`/`exists`/`list` trait; `Main.scala:63-65` already constructs a
  single `fileSystem` instance from `HELIO_UPLOADS_BACKEND` and threads it into `ApiRoutes` — reuse as
  claimed is real and wired.

- **`ContentSourceSupport.validateExtension` / `ImageExtensions`** —
  `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala:245-262` confirms the exact
  signature (`(filename, allowed: Set[String])`) and that `ImageExtensions` includes `bmp` (design's
  claim that the ticket's allow-list is narrower is correct).

- **`binary_refs` (V46) shape/RLS claim** — read
  `backend/src/main/resources/db/migration/V46__binary_refs.sql`: the table is keyed on
  `(data_type_id, row_index, field_name)` with an `EXISTS`-subquery RLS policy through
  `data_types.owner_id`, confirming design.md's rationale for *not* reusing it (there is no
  `data_type_id` for a panel-literal upload).

- **`ApiRoutes.scala` auth split** — read the file in full. `authDirectives.optionalAuthenticate` mounts
  `PublicDashboardRoutes` at line 118-120 (design's "line ~118" is accurate); `authDirectives.authenticate`
  gates every other route from line 121. Mounting a new `PublicUploadRoutes` alongside
  `PublicDashboardRoutes` and `UploadRoutes` inside the authenticated block is structurally consistent
  with the existing pattern.

- **`httpClient.ts` Bearer-token claim** — confirmed `httpClient.ts:10-12` sets
  `httpClient.defaults.headers.common["Authorization"] = Bearer ${token}` (an axios default header, not a
  cookie) — a plain `<img src>` genuinely cannot carry it, supporting Decision 2's unauthenticated-GET call.

- **`ImagePanel.tsx` sanitizer / `ImageEditor.tsx` baseline** — confirmed `sanitizeImageUrl` currently
  calls the baseless `new URL(url)` and rejects non-`http(s)` protocols exactly as design.md describes;
  `ImageEditor.tsx` currently has only a URL `TextField` + fit `Select`, matching the "Upload" button being
  additive.

- **Multipart/size-limit pattern claim** — `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala`
  confirms `csvMaxBytes`/`textMaxBytes`/`pdfMaxBytes`/`imageMaxBytes` are all
  `sys.env.get("X_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(default)` with a route-layer
  pre-check + later authoritative check — Decision 5's departure from `application.conf` is accurate and
  consistent.

- **V54 is the next free Flyway version** — `ls backend/src/main/resources/db/migration` confirms
  `V53__panel_column_widths.sql` is the max; no `V54` exists yet.

- **HEL-245 scope boundary** — grepped all planning artifacts for HEL-245: `ticket.md`, `proposal.md`
  (Non-goals), and `design.md` (Planner Notes) all correctly exclude Markdown-panel wiring. No drift found.

- **No HEL-216 duplication** — grepped `image_uploads`/`ImageUpload` across `backend/src/main` and
  `frontend/src`: no existing table or class by that name; the only near-collision is
  `DataSourceService.createImageUpload` (HEL-216's data-source-connector method, different package/purpose)
  — not a functional duplication, only a naming echo worth the executor's awareness.

- **CONTRIBUTING.md's binding RLS-guard protocol, and a real gap against it** — CONTRIBUTING.md (lines
  93-100) states explicitly: *"Adding a new ACL'd table... 3. Add the table name to the `rlsTables`
  allowlist in `RlsPolicyGuardSpec` — the guard spec will fail CI if this step is missed."* I read
  `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` in full: `rlsTables` (lines
  53-68) is a hardcoded `Set[String]` that includes `"binary_refs"` (added with V46/HEL-217) but the spec
  only iterates *that* set — it does not reverse-check against all RLS-enabled tables in the DB, so in
  practice a missed addition would **not** fail CI (CONTRIBUTING.md's claim is aspirational/stale), but the
  binding instruction to add the table is still explicit and unconditional. **`tasks.md` never mentions
  adding `"image_uploads"` to this allowlist** — task 1.1 covers the migration/RLS/policy/index but stops
  there, and task 5.3 only says "mirrors rls-owner-tables test patterns" (a different, per-table spec) with
  no mention of `RlsPolicyGuardSpec`. A competent implementer following `tasks.md` literally would ship a
  correctly-RLS'd table that is nonetheless invisible to the codebase's own regression guard — silently
  defeating the exact mechanism CONTRIBUTING.md describes for this scenario.

- **MIME-type derivation is unspecified, with a reproduced landmine** — grepped `design.md`/`tasks.md`/
  `specs/image-upload/spec.md` for "mime"/"MIME": nowhere do they say *how* `ImageUploadService` derives the
  `mime_type` value it stores and later serves as `Content-Type`. The only existing extension→MIME map in
  the codebase is `ImageSourceSupport.mimeTypeByExtension` (private, `ImageSourceSupport.scala:16-23`),
  reached only via `dimensionsAndMime`, which additionally calls `javax.imageio.ImageIO.read` to get
  width/height — a decode step this ticket doesn't need. The ticket's own orchestrator notes explicitly
  nudge the executor toward this exact file ("look at `ImageSourceSupport.scala` ... for existing
  image-handling code before writing new code"). I reproduced, on this exact JVM/toolchain, that
  `ImageIO.getReaderFormatNames()` contains no `"webp"` entry (compiled and ran a one-off `ImageIO` probe;
  output: `WEBP supported: false`) and confirmed `backend/build.sbt` pulls in no WebP-capable ImageIO plugin
  (e.g. TwelveMonkeys). If the executor reuses `dimensionsAndMime` for MIME derivation (a plausible reading
  given the ticket's own hint), every `.webp` upload — one of the five extensions the spec and tasks.md
  §5.1 explicitly require to succeed — would be rejected as "corrupt or unsupported codec," even though the
  bytes are a perfectly valid WebP file. This is a genuine, reproduced landmine the design doesn't
  foreclose.

### Verdict: REFUTE

The overall shape of the design is sound and well-grounded — every load-bearing technical claim I checked
against the real codebase (`FileSystem`, `ContentSourceSupport`, `binary_refs`' RLS shape, the
`ApiRoutes.scala` auth split, `httpClient.ts`'s Bearer-token mechanism, the existing multipart/size-limit
pattern, `ImagePanel.tsx`'s sanitizer) held up, and the HEL-245/HEL-216 scope boundaries are correctly
drawn. But two concrete gaps in `tasks.md` would let a competent implementer ship code that either violates
a binding codebase convention or silently fails one of the ticket's own required test cases. Both are
narrow and fast to fix.

### Change Requests

1. **Add the CONTRIBUTING.md-mandated `RlsPolicyGuardSpec` update to `tasks.md`.** Add a task item (in
   section 1 or 5) instructing the executor to add `"image_uploads"` to the `rlsTables` allowlist in
   `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` (mirroring how `"binary_refs"`
   was added for V46/HEL-217) in the same PR as the migration, per CONTRIBUTING.md's explicit "Adding a new
   ACL'd table" checklist (line ~93-100).

2. **Specify the MIME-type derivation in `design.md`/`tasks.md`, and explicitly rule out
   `ImageSourceSupport.dimensionsAndMime`.** Add a decision (or amend Decision 4) stating that
   `ImageUploadService` derives `mime_type` from a small, local, extension-keyed literal map scoped to the
   ticket's five allowed extensions (`png`, `jpg`, `jpeg`, `gif`, `webp` → their standard MIME types) — not
   by calling `ImageSourceSupport.dimensionsAndMime`/`ImageIO.read`, since this JVM's stock `ImageIO` has no
   WebP reader (reproduced: `ImageIO.getReaderFormatNames()` omits `"webp"`) and would reject every valid
   `.webp` upload despite `webp` being an explicitly required allowed extension in both the ticket and
   `specs/image-upload/spec.md`. This also keeps the new service decoupled from the connector's
   width/height concern, which this ticket doesn't need.

### Non-blocking notes

- `DataSourceService.createImageUpload` (HEL-216) and the new `ImageUploadService`/`ImageUpload` naming are
  close enough that a reader skimming a stack trace or grep result could momentarily confuse the two;
  consider a doc-comment cross-reference in the new service noting they are unrelated, once written.
- `tasks.md` §1.1's `owner_id UUID NOT NULL` has no `REFERENCES users(id)` FK, unlike some (but not all)
  existing owner columns (e.g. V10, V32) — inconsistent precedent exists both ways in this codebase
  (`data_sources`/`data_types`'s `owner_id` also lack the FK), so this is a judgment call, not a defect.
