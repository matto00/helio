# Workflow State — HEL-216

TICKET_ID: HEL-216
CHANGE_NAME: image-connector
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/feature/image-data-source-connector/HEL-216
BRANCH: feature/image-data-source-connector/HEL-216
PHASE: Delivery
CYCLE: 3
DEV_PORT: 5389
BACKEND_PORT: 8296
EXECUTOR_AGENT_ID: a0c9e86618d3b1453
EVALUATOR_AGENT_ID: ae494b73c9a37b8d8
LAST_EVAL_VERDICT: PASS
LAST_EVAL_REPORT: /home/matt/Development/helio/.claude/worktrees/feature/image-data-source-connector/HEL-216/openspec/changes/image-connector/evaluation-2.md
SKEPTIC_CYCLE: 2
LAST_SKEPTIC_VERDICT: CONFIRM (final gate, round 2)

NOTES: Final gate round 1 REFUTEd on a real, live-reproduced UI defect (report at
openspec/changes/image-connector/skeptic-final-1.md): ImageSourceForm's Cancel/Create-source
buttons render with zero visual chrome because the CSS classes they use
(add-source-modal__btn/--primary/--secondary, add-source-modal__actions) are never defined
anywhere in the CSS, on this branch or origin/main (a pre-existing gap shared with the
already-merged Text/Pdf/Static sibling forms, but this ticket's own new form is affected too).
Proposed fix (scoped, additive, in AddSourceModal.css only): add the missing CSS rules mirroring
Modal.css's existing .ui-modal-btn token-based button system. Resuming executor with this change
request.

Prior history: Cycle-1 BLOCKER (cross-worktree Flyway V48 collision with parallel HEL-214/PDF worktree)
was resolved via rebase onto origin/main (481d97b, HEL-214 merged as PR #209) + migration renumber
to V49 — see prior notes below. Evaluator re-ran full review post-rebase: Phase 1 PASS, Phase 2 +
Phase 3 both FAIL on the same defect: `ImageSourceSupport.dimensionsAndMime`
(services/ImageSourceSupport.scala:44) only catches `ImageIO.read` returning `null`; a
truncated-but-header-valid corrupt image causes `ImageIO.read` to throw `IIOException`
(uncaught), producing a raw 500 instead of a graceful 400 — reproduced live (direct multipart
upload of a truncated PNG) and via an isolated JVM harness. Contradicts the sibling
`PdfTextSupport.validate` (HEL-214) pattern, which correctly wraps `Loader.loadPDF` in
try/catch. Zero test coverage of this exception path across all 3 test layers (all "corrupt
image" fixtures use total-garbage bytes, not a truncated-but-recognizable image). Change requests:
(1) wrap `ImageIO.read` in try/catch for IOException, mapping to the same Left(...) message as the
null case, mirroring PdfTextSupport.validate; (2) add a truncated-real-image test case at all 3
test layers (ImageSourceSupportSpec, DataSourceServiceSpec, DataSourceRoutesSpec); (3) re-run full
gates fresh and report new counts (do not reuse 1164/814).

Resuming executor cycle 2 with EVALUATION_REPORT_PATH = above.

--- executor cycle 3 fix (post-REFUTE, final gate round 1) ---
Fixed the single change request from skeptic-final-1.md: added the missing CSS rules for
`.add-source-modal__actions` / `.add-source-modal__btn` / `--primary` / `--secondary` to
`frontend/src/features/sources/ui/AddSourceModal.css`, mirroring the token-based values already
established in `shared/ui/Modal.css`'s `.ui-modal-btn` system (`--app-*`/`--space-*`/`--text-*`
tokens only, no new one-off values). Additive-only — no `.tsx` files touched, since
`ImageSourceForm.tsx` and its already-merged siblings (`TextSourceForm.tsx`/`PdfSourceForm.tsx`/
`StaticSourceForm.tsx`) already reference these class names; fixing the CSS fixes all four forms'
buttons as a side effect. Verified visually via a Playwright script (logged into the running dev
frontend on port 5389, opened Add Data Source -> Image type, screenshotted the footer buttons and
read `getComputedStyle`) in both light and dark themes: Cancel now shows a visible bordered
secondary-button style, Create source shows the filled orange primary style — matching
`.ui-modal-btn`'s look exactly, no more plain unstyled text. Fresh gates post-fix: `npm run lint`
clean (0 warnings), `npm run format:check` clean, `npm --prefix frontend run build` succeeds,
`npm test` 814/814 (unchanged count — CSS-only fix, no test changes needed). No backend files
touched, so `sbt test` was not re-run for this cycle (last known-good: 1167/1167 from cycle 2).
Committed as a new commit on top of the cycle-2 fix commit. Nothing pushed to origin.

--- executor cycle 2 fix (post-FAIL) ---
Fixed the single real defect from evaluation-1.md's Phase 2/3 FAIL:
`ImageSourceSupport.dimensionsAndMime` now wraps `ImageIO.read` in a `try/catch` for
`java.io.IOException` (which `javax.imageio.IIOException` extends), mapping it to the same
`Left(...)` message already used for the documented `null`-return case — mirroring
`PdfTextSupport.validate`'s established try/catch structure. Verified via an isolated JVM probe
(dropRight(30) on a 16x16 PNG) that the construction used in the new tests genuinely hits the
`IIOException`-throw branch, not the `null`-return branch, before relying on it in three new test
cases: `ImageSourceSupportSpec` (unit), `DataSourceServiceSpec` (`createImageUpload`), and
`DataSourceRoutesSpec` (route-level 400 assertion). Fresh gates post-fix: `sbt test` 1167/1167
(+3 vs. prior 1164), `npm test` 814/814 (unchanged, no frontend touched), lint/format:check/
check:schemas/check:scala-quality all clean (same 40 pre-existing soft file-size warnings, no new
hard violations). Committed as a new commit (not amended) on top of f69fbb9. Nothing pushed to
origin.

--- prior cycle-1 rebase resolution notes (superseded phase, kept for history) ---
RESOLVED (post-HEL-214-merge rebase, executor cycle 2 of that BLOCKER): HEL-214 merged to
origin/main (481d97b, PR #209) taking V48__add_pdf_source_type.sql. Rebased this branch onto
origin/main; renamed this branch's migration V48 -> V49__add_image_source_type.sql and widened its
CHECK constraint to include both 'pdf' and 'image' (additive on top of V48's constraint). Resolved
16 conflicted files; both HEL-214's `pdf` case and this ticket's `image` case verified present in
every closed match. Reconfirmed SSRF guard: no bespoke HTTP client introduced. Fresh post-rebase
gates (pre-this-FAIL): sbt test 1164/1164, npm test 814/814, lint/format/build clean. Commits:
f583754 (rebase), f69fbb9 (fixup). Nothing pushed to origin yet.
