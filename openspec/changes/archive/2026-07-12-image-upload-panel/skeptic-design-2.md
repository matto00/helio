## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Read all planning artifacts in full**: `ticket.md`, `proposal.md`, `design.md`,
  `specs/image-upload/spec.md`, `specs/image-panel-type/spec.md`, `tasks.md`, and the round-1
  report (`skeptic-design-1.md`), treated as claims to re-verify, not fact.

- **Fix 1 (RlsPolicyGuardSpec allowlist) — adequately integrated.**
  `tasks.md` task 1.4 now explicitly instructs adding `"image_uploads"` to the `rlsTables`
  allowlist in `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala`,
  citing CONTRIBUTING.md's "Adding a new ACL'd table" checklist. I read the live
  `RlsPolicyGuardSpec.scala` (lines 46-69): the `rlsTables: Set[String]` is exactly as
  described (`"binary_refs"` present from V46/HEL-217, doc-comment at lines 48-51 spelling out
  the two-step "same PR" requirement) — task 1.4's instructions match the real mechanism
  precisely, not a paraphrase drift. I also re-read CONTRIBUTING.md lines 93-102 ("Adding a new
  ACL'd table": 1. RLS+FORCE RLS in migration, 2. policies, 3. add to `rlsTables` allowlist, 4.
  owner-id index) — task 1.1 covers items 1/2/4 (index on `owner_id`, ENABLE/FORCE RLS, policy)
  and task 1.4 now covers item 3. All four checklist items are covered across tasks.md.

- **Fix 2 (MIME derivation) — adequately integrated, and I found independent corroborating
  evidence the fix is not just correct but necessary for a reason the design doesn't even state.**
  `design.md` Decision 4 and `tasks.md` task 2.1 now both explicitly say `ImageUploadService`
  derives `mime_type` from its own small local extension-keyed literal map and must NOT call
  `ImageSourceSupport.dimensionsAndMime`, citing the WebP-reader gap. I read the live
  `ImageSourceSupport.scala` in full: `mimeTypeByExtension` (lines 16-23) is a **`private`** val
  inside the `object ImageSourceSupport` — it is not reachable from outside that file at all, only
  through `dimensionsAndMime`, which forces the `ImageIO.read` decode step. So even setting aside
  the WebP-reader landmine, reuse of the existing map was never mechanically possible without
  either (a) making it public (an unplanned, unreviewed change to HEL-216 code) or (b) going
  through the decode path this ticket doesn't need. The design's "own small local literal map" is
  therefore not just the safe choice but the only choice that doesn't touch HEL-216's file — a
  stronger justification than what's written, but the written decision is correct and sufficient.

- **`ContentSourceSupport.ImageExtensions`/`validateExtension`** — re-confirmed at
  `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala:245-262`: `ImageExtensions`
  is `{png, jpg, jpeg, gif, webp, bmp}`; `validateExtension(filename, allowed: Set[String])` takes
  an explicit allow-list param exactly as design.md Decision 4 and tasks.md 2.1 describe.

- **`FileSystem` trait** — re-read in full
  (`backend/src/main/scala/com/helio/infrastructure/FileSystem.scala`): `write`/`read`/`delete`/
  `exists`/`list` signatures match every usage the design/tasks assume (`FileSystem.write` at
  `images/<uuid>.<ext>`, `findById`-then-`FileSystem.read` for serving).

- **`Main.scala` (actually `backend/src/main/scala/com/helio/app/Main.scala`) fileSystem wiring**
  — confirmed a single `fileSystem` instance is constructed (line 63) from
  `HELIO_UPLOADS_BACKEND` and threaded through; reuse as claimed is real. (Minor: design.md/tasks.md
  say "`Main.scala`" without the `app` package qualifier — immaterial, not a defect.)

- **`ApiRoutes.scala` auth split** — re-confirmed: `authDirectives.optionalAuthenticate` mounts
  `PublicDashboardRoutes` at line 118-119; `authDirectives.authenticate` gates the authenticated
  route list from line 121. Mounting `PublicUploadRoutes` alongside the former and `UploadRoutes`
  alongside the latter is structurally consistent with the existing pattern, as design.md claims.

- **Multipart/size-limit precedent** — re-confirmed in `DataSourceRoutes.scala`:
  `imageMaxBytes`, `createMultipartUploadRoute`, `entity(as[Multipart.FormData])`, and a
  route-layer size check that returns an error response — matches tasks.md 2.1/2.2's stated
  pattern reuse.

- **`binary_refs` (V46) shape/RLS** — re-read the full migration: keyed on
  `(data_type_id, row_index, field_name)` with an `EXISTS`-subquery policy through
  `data_types.owner_id` — confirms design.md Decision 1's rationale for a new table rather than
  forcing this shape.

- **Frontend baselines** — re-read `ImagePanel.tsx` (`sanitizeImageUrl` currently calls the
  baseless `new URL(url)`, rejects non-http(s) protocols) and `ImageEditor.tsx` (currently only a
  URL `TextField` + fit `Select`, no upload control) — both match what design.md/tasks.md describe
  as the pre-change baseline, so the planned additive changes are accurately scoped against real
  code, not an imagined one.

- **`httpClient.ts` Bearer-token claim** — re-confirmed lines 10/12: axios default header
  `Authorization: Bearer <token>`, never a cookie — supports Decision 2's unauthenticated-GET
  rationale (an `<img src>` genuinely cannot attach it).

- **No naming/table collisions** — grepped `image_uploads`, `ImageUploadService`,
  `ImageUploadRepository` across `backend/src`, `frontend/src`, `schemas/`, `openspec/` (excluding
  this change's own dir): zero hits. No pre-existing code this change would silently clash with.

- **Flyway version** — `ls backend/src/main/resources/db/migration | sort -V | tail` confirms
  `V53__panel_column_widths.sql` is still the max; `V54` in tasks.md 1.1 is correct.

- **Fresh pass beyond the two prior items** — checked scope boundaries (HEL-245 exclusion still
  correctly stated in proposal.md Non-goals and design.md Planner Notes), checked the
  spec deltas (`image-panel-type/spec.md`'s MODIFIED requirement correctly describes both the old
  and new accepted URL shapes, with scenarios for both), and re-checked internal consistency
  between design.md/tasks.md/specs (extension set, error codes, storage path, RLS context split)
  — no contradictions found. No placeholders, TBDs, or deferred decisions remain in any artifact.

### Verdict: CONFIRM

Both round-1 change requests are genuinely fixed, not just bolted on with wording — task 1.4's
instructions match the live `RlsPolicyGuardSpec` mechanism exactly, and Decision 4's MIME-map
choice is not only correctly stated but is in fact the *only* mechanically available option, which
I confirmed independently by reading `ImageSourceSupport.scala` and finding the existing map is
`private`. A fresh, from-scratch pass over every artifact and every load-bearing technical claim
against the real codebase (FileSystem, ContentSourceSupport, binary_refs' RLS shape, the
ApiRoutes.scala auth split, httpClient.ts's Bearer mechanism, the multipart/size-limit precedent,
both frontend baselines, Flyway versioning) turned up no new gaps, contradictions, or scope drift.
The design is sound and ready for execution.

### Non-blocking notes

- Decision 4's rationale in design.md could be strengthened by noting
  `ImageSourceSupport.mimeTypeByExtension` is `private` (not just "has an unwanted decode step") —
  makes the "own local map" choice look like the only option it actually is, rather than a
  stylistic preference. Purely cosmetic; not a blocker.
