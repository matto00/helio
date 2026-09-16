## 1. Backend — kind-level metadata

- [x] 1.1 Add a sealed `StepGroup` ADT declaring each group's id, label and display order in one place; verify a unit test asserts the declared order is stable and ids are unique
- [x] 1.2 Extend `PipelineStep.Companion` with `group: Option[StepGroup] = None`, `catalogDescription: String`, `authorable: Boolean = true`; verify `sbt compile` succeeds with no companion yet edited (defaults prove absent group is not a compile error)
- [x] 1.3 Declare `group` and `catalogDescription` on each of the 27 companions in `domain/steps/`; verify a test asserts every `Registry` entry has a non-blank description
- [x] 1.4 Declare `authorable = false` on `JoinStep` and `GroupByStep` companions only; verify a test asserts exactly the intended unauthorable set

## 2. Backend — catalog endpoint

- [x] 2.1 Add a catalog service projecting `PipelineStep.Registry` into ordered groups plus one entry per kind; verify a unit test asserts entry discriminators equal `Registry.keySet` exactly
- [x] 2.2 Add the response protocol with `groups` and `steps` as ordered arrays and `group` as an `Option`; verify a JSON test asserts an ungrouped entry serializes with the group key ABSENT (not null)
- [x] 2.3 Add `PipelineStepCatalogRoutes` on a distinct top-level prefix `pipeline-step-catalog`; verify a route test returns 200 with the full catalog
- [x] 2.4 Wire the routes into `ApiRoutes.scala` inside the `authenticatedUser` tree; verify a route test asserts an unauthenticated request is refused
- [x] 2.5 Add `schemas/pipelines/pipeline-step-catalog.schema.json` with `additionalProperties: false`; verify the schema-drift pre-commit check passes

## 3. Frontend — data access

- [x] 3.1 Add the catalog TS types mirroring the wire shape with `group?: string`; verify `npm run typecheck` passes
- [x] 3.2 Add `getPipelineStepCatalog()` to `pipelineService.ts` as a direct service call with no Redux slice; verify a service unit test asserts the request path
- [x] 3.3 Reduce `OP_TYPES` to an icon map keyed by kind with a default-glyph fallback, keeping `isTempStepId` and `requiresCompleteConfigForCreate` exports untouched; verify existing `stepNarrowing` tests still pass

## 4. Frontend — the palette

- [x] 4.1 Build `StepPalette` on the shared `Modal` with a focused `TextField` filter, reusing `CommandPalette`'s `.eyebrow` group label and icon/title/subtitle row markup; verify it renders every authorable entry from a fixture catalog
- [x] 4.2 Implement live filtering over label and description that flattens across groups while active; verify a test asserts a description-only match stays visible and results are not grouped
- [x] 4.3 Add the `EmptyState` zero-results branch and a real error-with-retry branch for a failed catalog fetch; verify tests cover both, and that neither renders an empty region
- [x] 4.4 Implement the flattened `activeIndex` keyboard contract — arrows across group boundaries, Enter selects, Escape closes via `Modal` and restores focus to the trigger; verify tests cover each key
- [x] 4.5 Exclude unauthorable entries from every view; verify a test asserts an `authorable: false` fixture entry is not selectable anywhere

## 5. Frontend — call-site migration

- [x] 5.1 Replace the gap-insert render site to open `StepPalette` carrying that gap's index through `onInsertStep`; verify a test asserts insertion at the gap index
- [x] 5.2 Replace both append render sites (empty-state and bottom row, sharing one trigger ref) to open `StepPalette` via `onAddStep`; verify a test asserts append position
- [x] 5.3 Replace `BranchAffordance`'s render site, preserving its branch anchor; verify a test asserts the branch context is used, not an append
- [x] 5.4 Delete `OpDropdown.tsx`, `OpDropdown.test.tsx` and any now-dead CSS; verify no import of `OpDropdown` remains anywhere

## 6. Tests

- [x] 6.1 Add the backend partition test: every `Registry` kind appears in the catalog exactly once, and each is either authorable or explicitly declared unauthorable; verify it goes red when a kind is added to a fake registry without a declaration
- [x] 6.2 Add the frontend failable check that every authorable catalog entry appears in "All" and no ungrouped entry appears in a category; verify it goes red for a fixture entry missing from "All"
- [x] 6.3 Replace the `KNOWN_UNLISTED_KINDS` drift guard with an icon-coverage guard over authorable kinds; verify it goes red for a kind with no icon entry
- [x] 6.4 Verify the palette's scroll containment replaces `OpDropdown`'s retired F-040 max-height clamp, and state in the commit body that the clamp mechanism is moot rather than regressed
- [x] 6.5 Run the nine add-step e2e specs; verify any red is an already-known HEL-992 signature and not a new one, re-running before concluding
- [x] 6.6 Compare the palette against the running app at both themes and confirm no new visual dialect; verify by screenshots written only into `.playwright-mcp/`

## Standing Constraints

- [C1] Compare the palette against the RUNNING APP in both light and dark themes; token compliance alone is not evidence of visual cohesion, and a new dialect is an escalation
- [C2] Pass `timeout: 600000` on every Bash call running a commit, a git hook, a squash, or a test suite
- [C3] Never commit with `-n`/`--no-verify`; fix the gate instead
- [C4] Playwright artifacts go only in the gitignored `.playwright-mcp/`, never the checkout root
- [C5] Test the ungrouped case with the group field ABSENT, not null; anything order-bearing must be a JSON array
- [C6] Route creates through the existing `requiresCompleteConfigForCreate` and use the exported `isTempStepId`; never re-derive op-name checks
