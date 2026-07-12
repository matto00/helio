## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 18 tasks.md items are marked done and match what's actually implemented (verified via diff + full-file reads of every touched file: V54 migration, `ImageUpload`/`ImageUploadId`, `ImageUploadRepository`, `RlsPolicyGuardSpec` allowlist entry, `ImageUploadService`, `UploadRoutes`, `PublicUploadRoutes`, `ApiRoutes.scala`/`Main.scala` wiring, `ImageUploadResponse` protocol + `package.scala` re-export, `panelService.uploadPanelImage`, `ImageEditor.tsx`, `ImagePanel.tsx`, docs, and all five test items).
- Ticket ACs (HEL-246: upload endpoint, MIME validation, `FileSystem`-only persistence under `images/` prefix, `{id, url}` response, byte-serving GET, Image panel config "Upload" button, URL stored like any other `imageUrl`) are all addressed explicitly, none partially or silently reinterpreted.
- DoD verified: upload-to-render works end-to-end (confirmed live in Phase 3); `notes/uploads-filesystem-layout.md` documents the layout; tests cover upload/serve/size-limit-reject/MIME-reject paths (`UploadRoutesSpec`, `RlsOwnerTablesSpec` additions).
- HEL-245 boundary respected — no Markdown-panel wiring was added; proposal.md Non-goals and design.md Planner Notes correctly scope this out.
- No scope creep. The one deviation-beyond-tasks.md item (the `ImagePanel.tsx` protocol-relative-smuggling guard, see Phase 2) is a narrow, disclosed hardening of the exact line task 3.3 already required to change — not new unrelated scope.
- No regressions: full backend (`sbt test`, 1290/1290) and frontend (`npm test`, 921/921) suites pass fresh.
- API contracts: `schemas/` ↔ `JsonProtocols` parity confirmed via `check:schemas` (fresh run: "schemas in sync ... 10 checked across 18 protocol files").
- Planning artifacts (design.md Decisions 1–7, proposal.md) match the final implementation exactly — decisions read as descriptions of the actual code, not aspirational.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md mechanical compliance**: no inline FQNs found in any new/modified file (spot-checked `ApiRoutes.scala`, `Main.scala`, `UploadRoutes.scala`, `PublicUploadRoutes.scala`, `ImageUploadRepository.scala`, `ImageUploadService.scala` — all qualifiers are top-of-file imports). `check:scala-quality` ran fresh: clean, 41 pre-existing soft warnings (file-size budget, informational-only per CONTRIBUTING.md), none attributable to new HEL-246 files (all new files are 44–248 lines, under the ~250 soft budget).
- **DESIGN.md mechanical compliance**: `PanelDetailModal.css` additions use only `--space-*`, `--control-md`, `--app-border-subtle`, `--app-radius-sm`, `--app-text-muted`, `--text-xs`, `--weight-medium`, `--app-transition`, `--app-border-strong`, `--app-surface-raised`, `--app-text`, `--app-accent` tokens — zero literal px/rem for real layout values. The only literal pixel values are the standard "visually-hidden" (`clip: rect(0,0,0,0)`, 1px/-1px) accessibility technique for the native file input, which is a structural a11y pattern, not a design-scale value. The new `.panel-detail-modal__upload-btn` matches DESIGN.md's "Secondary" button recipe verbatim (transparent bg, `--app-border-subtle` hairline, muted text; hover → `--app-border-strong` + `--app-surface-raised` + full text).
- **DRY**: reuses `ContentSourceSupport.validateExtension` (existing helper, just a narrower allow-list param), the `FileSystem` abstraction, the existing `DbContext.withUserContext`/`withSystemContext` pool-selection pattern, and the existing raw-`<button>` convention already used by sibling editors (`BoundOrLiteralField.tsx`, `DataTypePicker.tsx`) rather than inventing a new shared Button component that doesn't otherwise exist in this codebase.
- **Readable/modular**: small single-purpose classes (`ImageUploadService` 83 lines, `UploadRoutes` 70, `PublicUploadRoutes` 44, `ImageUploadRepository` 90); every non-obvious decision (MIME map instead of `ImageIO`, unauthenticated GET, RLS asymmetry) is documented inline with a design.md cross-reference.
- **Type safety**: no `any` in new TS; `UploadPanelImageResponse` interface typed; Scala uses value-class `ImageUploadId`/`UserId` wrappers at the route boundary via `ImageUploadIdSegment`, matching CONTRIBUTING.md's ID-wrapping rule.
- **Security**: extension allow-list enforced at the route level before any `FileSystem.write` (task 2.2/2.3 requirement); size limit enforced at both route (fast-reject) and service (authoritative) layers; RLS enabled + forced on `image_uploads` with a direct-owner policy; unauthenticated GET is an explicit, documented trust-model decision (matches the pre-existing untrusted-external-URL model, not a new hole). The `sanitizeImageUrl` protocol-relative-smuggling guard was traced end-to-end (see below) and is sound.
- **Error handling**: `400`/`413`/`401`/`404` all mapped and tested; frontend upload failures show `InlineError` without clobbering the prior `imageUrl` (verified in `PanelDetailModal.test.tsx` and live in Phase 3 via the analogous failure-path code read).
- **Tests meaningful**: `UploadRoutesSpec` covers all 5 extensions, missing file, unsupported extension, oversized, at-limit, unauthenticated POST, unauthenticated GET (valid + 404). `RlsOwnerTablesSpec` seeds via `ImageUploadRepository.insert` (the real write path) rather than raw SQL, proving the RLS policy is actually enforced through the code path, not just declared to exist. Frontend tests cover both the root-relative render case and the smuggling-guard case, plus the editor's success/failure upload flow.
- **No dead code**: no leftover TODO/FIXME, no unused imports in the diff.
- **No over-engineering**: no premature abstraction — a single narrow-purpose table/service/route pair, explicitly justified against reusing `binary_refs` (which would have been the over-engineered choice: forcing an unrelated shape to fit).
- **Not a refactor** — pure additive feature; behavior-preservation is N/A here.

**Gate-deviation verification (explicit per orchestrator instruction)**:
- Reproduced the `check:openspec` failure independently: `openspec list --json` on this worktree reports `"status": "complete"` (18/18 tasks) for `image-upload-panel`, and `npm run check:openspec` fails with exactly the structural message the executor described ("change ... is complete (18/18) but not archived"). This is a genuine tooling-ordering gap (archiving is a later delivery-pipeline phase, not something the executor can do at commit time), not a disguised real failure.
- Precedent commit `0fadf8e3` (HEL-244) bypasses the identical hook for the identical stated reason, confirming this is an established, accepted pattern rather than a one-off excuse.
- Commit `9bcdfae2`'s body explicitly discloses the bypass, names the specific hook, explains why, and lists which hooks *did* run clean — satisfying CONTRIBUTING.md's "even then the situation must be called out explicitly in the commit body" requirement.
- Independently re-ran (fresh, not trusting the executor's report) every other gate: `npm run lint` (clean), `npm run format:check` (clean), `npm run check:schemas` (in sync), `npm run check:scala-quality` (clean, informational warnings only), `npm test` (84 suites / 921 tests pass), `npm --prefix frontend run build` (succeeds), `sbt test` (1290/1290 pass, including a targeted re-run of `UploadRoutesSpec`/`RlsOwnerTablesSpec`/`RlsPolicyGuardSpec`). All match the executor's claims exactly.

**sanitizeImageUrl defensive-addition verification (explicit per orchestrator instruction)**:
- Traced all three branches by hand and confirmed against the live browser: an absolute `https://...` URL falls through to the `parsed.href` branch unaffected; a genuine root-relative `/api/uploads/image/<id>` path satisfies `url.startsWith("/") && !startsWith("//") && parsed.origin === window.location.origin` and is returned as the literal path (required scenario, verified rendering live); a protocol-relative `//evil.example.com/x.png` fails the `!startsWith("//")` clause and falls through to `parsed.href`, which resolves to `http://evil.example.com/x.png` — the exact same trust level as a user typing that URL directly (no new host is trusted, nothing is newly blocked that wasn't already implicitly allowed). This is a narrow normalization/labeling fix, not a behavior-changing security control, and it does not regress either of the two spec-required scenarios (absolute http(s) URLs, root-relative upload paths) — both were re-verified rendering correctly in a live browser session in Phase 3.

### Phase 3: UI Review — PASS
Issues: none blocking.

Dev servers started via the canonical script; `assert-phase.sh servers` returned `PASS`.

- **Happy path end-to-end**: logged in, created a fresh dashboard, added an Image panel, opened its config editor — the "Upload" control (hidden file input + visible button) renders beside the URL field as specified. Uploaded a real PNG via a direct authenticated request using the browser's actual session token (the Playwright toolset available in this environment has no OS file-picker automation hook, so the network round trip was exercised directly against the live server instead of simulating browser file-input interaction — the client-side `onChange` → `uploadPanelImage()` wiring itself is covered by the passing `PanelDetailModal.test.tsx` RTL tests, which do simulate `fireEvent.change` on the file input). Set the returned root-relative URL into the field, saved, and confirmed the image rendered correctly both in the settings preview and the live panel grid, and again after a full page reload (proving persistence + the unauthenticated GET route work end-to-end from a cold load).
- **Unhappy paths**: verified live — unsupported extension (`.pdf`) → `400` with a clear message; unauthenticated POST → `401`; unknown id GET → `404`. Frontend inline-error-on-failure behavior (leaves prior `imageUrl` untouched) is covered by passing RTL tests.
- **Loading/empty/error states**: "No image URL set" placeholder renders correctly for an unset panel; "Uploading…" button-disabled state is present in code; `InlineError` component (shared) used for upload failures.
- **No console errors**: confirmed 0 errors in the current navigation's console history (the large batch of errors returned by `all: true` was leftover cross-session noise from other worktrees/ports sharing the same MCP browser instance, not from this test).
- **Entry points**: Image panel reachable via "Add panel" → Image → any template → Customize → Edit, the only entry point this ticket adds.
- **Accessibility**: "Upload" button has an accessible name; the file input carries `aria-label="Upload image file"`; keyboard-operable via the visible button (native file input is visually hidden via the sr-only pattern, not `display:none`, so it remains in the tab/focus order and `:focus-visible` styling is defined).
- **Breakpoints**: 1440 / 1100 / 768 / 414 all render without layout breakage — the image panel and its content scale cleanly at every width tested.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Phase 3's upload-control interaction was verified via a direct API call (real session token) rather than driving the OS file-picker through Playwright, since the current MCP Playwright tool surface doesn't expose a `setInputFiles`-equivalent. The client-side trigger path is still covered by passing RTL tests (`PanelDetailModal.test.tsx`), so this is a tooling-coverage note, not a gap in the implementation itself.
