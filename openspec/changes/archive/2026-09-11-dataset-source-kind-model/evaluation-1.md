## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
- AC1 ("Creating a source with `type: "dataset"` round-trips"): confirmed by executor's manual
  round-trip and by fresh `DataSourceProtocolSpec`/`DataSourceRoutesSpec` assertions; also
  independently exercised end-to-end by `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` (rerun
  fresh, PASS — see Phase 3).
- AC2 ("`type: "static"` still round-trips and resolves to `dataset`"): implemented per design
  Decision 2/3 — `canonicalize`, `parseKind`, the `DataSourceProtocol.scala:502` discriminator
  match (`Static | Dataset`), and every kind-string call site named in design.md Decision 2/5 all
  updated. Verified directly in the diff (`DataSource.scala`, `DataSourceProtocol.scala`,
  `PipelineService.scala`, `PipelineProposalService.scala`, `PipelineProposalProtocol.scala`,
  `PatchSetApplyResolvers.scala`) and by the new alias round-trip tests in
  `PipelineRootRoutesSpec`, `PipelineApplyProposalSpec`, `PatchSetApplyServiceSpec`.
- AC3 ("`ConnectorRegistrySpec` passes"): confirmed — full `sbt test` run fresh (4076 tests,
  0 failed).
- Design Decision 1 (rename, no sibling ADT member) — implemented exactly: `StaticSource` renamed
  to `DatasetSource`, `kind = "dataset"`, no second case added.
- Design Decision 2 (canonicalize helper at every real entry point, not just `parseKind`) — all six
  named call sites (`PipelineService.scala:759/1588` equivalents, `PipelineProposalProtocol.scala`,
  `PipelineProposalService.scala` x5, `PatchSetApplyResolvers.scala`, `AssistantProposalToolSchemas.scala`)
  verified updated in the diff.
- Design Decision 3/4 (read-side `"dataset"`, Manual-tab frontend fix) — `AddSourceModal.tsx`,
  `SourceTypeToggle.tsx`, and all named consumer files present in the diff per `files-modified.md`.
- Design Decision 5 (alias round-trip tests for non-`/api/data-sources` write paths) — three new
  tests added exactly where named (`PipelineRootRoutesSpec`, `PipelineApplyProposalSpec`,
  `PatchSetApplyServiceSpec`), including the required backward-compat case (a stored patch-set with
  `type: "static"` still applies).
- All 24 tasks.md items are checked and match the diff — no gap found between a checked task and
  what's actually in the code (spot-checked sections 1–6 against `git diff`).
- No scope creep found: grep sweep for `"static"` in `backend/src/main` and `frontend/src` (excluding
  tests) shows only comments/docstrings remain outside the intentional alias machinery
  (`DataSourceKind.Static`, `canonicalize`, the one discriminator match arm) — matches Decision 2's
  "no other code path" constraint.
- No regression to unrelated specs: `ConnectorRegistry.all`'s position/`displayName`/`authKind`/
  `requiredFields` for the dataset connector unchanged per Decision 4; confirmed in the diff
  (`ConnectorRegistry.scala`, kind renamed only).
- API contracts updated: `schemas/pipelines/pipeline-proposal.schema.json` and
  `create-pipeline-request.schema.json` both gained `"dataset"` in their `type` enum (write-side
  alias intact, `"static"` not removed) — matches Decision 3.
- Planning artifacts reflect final implementation — tasks.md's evidence notes (4.4, 5.7, 6.1–6.3)
  match the gate results independently reproduced in Phase 2/3 below. HEL-1118 (repo-wide scaladoc
  sweep) is correctly left out of scope; only the renamed class's own scaladoc was touched, per the
  ticket's explicit exclusion.

No issues found.

### Phase 2: Code Review — PASS
Gates re-run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` set):
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean, all files match Prettier style.
- `npm test` (frontend) — 301 suites / 3197 tests, all passed.
- `npm --prefix frontend run build` — succeeded (production build, PWA precache generated).
- `cd backend && sbt test` — **4076 tests, 0 failed, all passed** (fresh run, ~5m21s), independently
  confirming the executor's own report rather than trusting it.
- `npm run check:scala-quality` — clean; zero inline-FQN violations introduced by this diff (162
  pre-existing file-size soft-budget warnings only, none in a file whose *size* this diff
  meaningfully grew — `DataSource.scala`, `PipelineService.scala`, `PipelineProposalService.scala`
  are pre-existing large files touched only for the rename/canonicalize additions).

Reviewed via diff + targeted full-file reads (`DataSource.scala`, `DataSourceProtocol.scala`,
`PipelineService.scala`, `PipelineProposalService.scala`, `PipelineProposalProtocol.scala`,
`PatchSetApplyResolvers.scala`, `DataSourceRepository.scala`):
- **Canonical code-quality compliance**: no violations found; `check:scala-quality` mechanically
  confirms no inline FQNs were introduced.
- **DRY**: `canonicalize` is a single shared helper reused at every call site rather than duplicated
  string comparisons; no unnecessary duplication observed.
- **Readable**: `DataSourceKind.Static`'s narrowed, documented purpose (used only inside
  `canonicalize` and one JSON match arm) is explicit in both the code comment and Scaladoc; no magic
  values — `"dataset"`/`"static"` are both named constants everywhere they matter.
- **Modular**: the alias-resolution concern is isolated to one pure function
  (`DataSourceKind.canonicalize`), separate from `parseKind`'s Either/validation concern, matching
  design Decision 2's stated rationale.
- **Type safety**: no `any`/untyped escape hatches introduced; TS unions extended with `"dataset"`
  consistently across `frontend/src/features/sources/types/dataSource.ts` and MCP-side types.
- **Security**: no new input-validation/injection surface — this is a rename plus a pure string
  alias resolution on an already-validated field.
- **Error handling**: `PatchSetApplyResolvers`'s reject-branch message correctly reports the new
  canonical name (`DataSourceKind.Dataset`) rather than the old literal; `SparkJobSubmitter`'s error
  string updated to say "dataset" per design.md's explicit note.
- **Tests meaningful**: the three new Decision-5 alias round-trip tests each cover a real
  branch (accept `"dataset"`, accept legacy `"static"`, and — for `PatchSetApplyServiceSpec` —
  reject an unrelated type), not just a happy path; the `DataSourceProtocolSpec` write/read-alias
  pair actually exercises the JSON-discriminator match arm added in Decision 2's final answer.
- **No dead code**: `DataSourceKind.Static` is not dead — it is the named literal `canonicalize`
  and the one documented match arm are built on; no leftover TODO/FIXME found in the diff.
- **No over-engineering**: a single pure-function alias resolver, not a general strategy/registry
  abstraction — appropriately sized for "one alias, one release."
- **Behavior-preserving where expected**: the type-rename sites (`InProcessPipelineEngine.scala`,
  `PatchSetPreviewProjection.scala`, `DataSourceService.scala`, `SparkJobSubmitter.scala`'s type
  match) are pure `StaticSource` → `DatasetSource` renames with no logic change, matching
  `files-modified.md`'s own characterization; spot-checked and confirmed no drive-by behavior change
  in these files.

No issues found.

### Phase 3: UI Review — PASS
Triggered (`frontend/**`, `schemas/**`, `openspec/specs/**` all touched).

Dev servers started via the canonical script and asserted healthy:
```
scripts/concertino/start-servers.sh ... 6505 9412 HEL-1073 → READY backend/frontend
scripts/concertino/assert-phase.sh servers ... → PASS servers
```

The interactive MCP Playwright browser was unavailable for this session (shared-browser lock from a
concurrent worktree run — a known environmental hazard, not this ticket's fault). Rather than skip
Phase 3, I ran the project's own e2e Playwright test runner (a separate, isolated Chromium instance
from the MCP browser) directly against the live dev servers — the same mechanism the executor used
for HEL-910 and named as the acceptance signal:

```
DEV_PORT=6505 BACKEND_PORT=9412 npx playwright test <13 specs> --config playwright.config.ts
```

Ran the executor's suggested set (all specs asserting/POSTing on `type: "static"` or a related read
path, excluding files already permanently quarantined by `playwright.config.ts`'s `testIgnore`
register — `hel666-single-assistant-entry.spec.ts` is quarantined for an unrelated pre-existing
defect, HEL-960, not this diff): `hel910-pipeline-to-dashboard-flow`, `hel519-recent-navigation`,
`hel520-focus-presence-guard.regression`, `hel908-step-card-split`, `hel908-trunk-reorder-drag`,
`hel908-trunk-reorder-order`, `hel1065-pin-toggle-css-fixes`, `hel813-mobile-touch-target-floor`,
`state-surface-contrast-guard`, `hel503-palette-global-resource-search`,
`hel516-palette-quick-create`.

**Result: 49/49 passed**, including `hel910-pipeline-to-dashboard-flow.spec.ts`'s full
source→pipeline→Outputs→dashboard flow (the one design.md names as the acceptance signal for
Decision 4's Manual-tab fix) and `state-surface-contrast-guard.spec.ts` (both light/dark themes,
every route, 490 probed elements). No console errors surfaced in any spec's output.

- Happy path (creating a dataset/manual source through the UI, placing it on a dashboard via a
  pipeline) — exercised end-to-end by `hel910`, PASS.
- Manual-tab rendering (the specific regression Decision 4 warns about) — exercised by `hel910`'s
  "manually-entered ('pasted') table" scenario, PASS. This directly confirms the Manual tab still
  renders after `AddSourceModal.tsx`/`SourceTypeToggle.tsx`'s `"static"` → `"dataset"` switch.
- No console errors during any of the 49 tests' runs.
- Keyboard/accessible-name coverage — `hel503`, `hel516`, `hel813` exercise keyboard reach and
  accessible names on multiple surfaces including the Add Source modal; all passed.
- Breakpoints — `hel813-mobile-touch-target-floor.spec.ts` covers 430px and 768px; `hel910`/others
  run at default desktop viewport. 1440/1100 were not separately exercised by this targeted subset,
  but this ticket changes no layout/CSS — only a string discriminator — so this is a low-risk gap,
  noted as non-blocking.

No issues found; targeted regression risk (Manual-tab render) directly disproven by passing tests
rather than by code-reading alone.

### Overall: PASS

### Non-blocking Suggestions
- Consider running the remaining unquarantined e2e specs (or the full suite) on a follow-up CI run
  for additional coverage breadth, since the full Playwright suite was not run this cycle either
  (targeted subset only, chosen to match the executor's named risk area).
