## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth.** `git diff main...HEAD` (HEAD f688d11d), 86 files. I read the whole production diff (backend main, frontend, helio-mcp, schemas, e2e) and the key test diffs. I treated the executor's and evaluator's reports as claims to check.

**Acceptance criteria. I checked each one against the live backend on :9412, which I confirmed via `/proc/<pid>/cwd` is this worktree's own process, not a server reused from another worktree.**
- AC1: `POST /api/data-sources {type:"dataset"}` returned 201 with `type: "dataset"`. The list endpoint also returns `type: "dataset"`, and preview returns 200 with the rows (`{"headers":["a"],"rows":[["1"],["2"]]}`). The code path is `DataSourceRoutes.createStaticRoute`'s fallthrough, then `createStatic`, then `DatasetSource`, then `StaticSourceResponse.type = DataSourceKind.Dataset`.
- AC2: `POST {type:"static"}` returned 201 with `type: "dataset"`, and the list also shows it as `dataset`. The non-`/api/data-sources` write paths call `DataSourceKind.canonicalize` before matching: `PipelineService` in two places, `PipelineProposalService` validate and resolve, `PipelineProposalProtocol`, and `PatchSetApplyResolvers`. New tests in `PipelineRootRoutesSpec`, `PipelineApplyProposalSpec` and `PatchSetApplyServiceSpec` cover both the canonical value and the legacy one, and `PatchSetApplyServiceSpec` also has a rejection case. `DataSourceProtocolSpec` pins the `Static | Dataset` discriminator arm.
- AC3: `ConnectorRegistrySpec` passes as part of the full suite. It also gained tests for `parseKind("static") == Right("dataset")`, `canonicalize`, and a check that `static` is not registered. `GET /api/connector-types` on the live server lists `dataset/Manual` third, in the same order as before.

**Design decisions.**
- D1: there is one ADT member, `DatasetSource` with `kind = "dataset"`, and no sibling member.
- D2: `canonicalize` is present. My grep of `backend/src/main` found no production comparisons against `DataSourceKind.Static` apart from the documented protocol arm and one repository read arm. The repository arm is defensive and harmless, because the DB check constraint rejects `static`.
- D4: the frontend Manual tab still renders. My probe clicked "Manual" and `#source-name-static` was visible in both themes.

**Remaining `"static"` literals (grep).** In production code, every remaining one is a comment, part of the alias machinery, or a write-side value that is deliberately still accepted. e2e specs and fixtures still POST `"static"`, which exercises the alias.

**Gates, re-run by me:**
- `sbt test`: 4076 succeeded, 0 failed, exit 0.
- Frontend `npm test`: 301 suites, 3197 tests, all passed.
- `npm run typecheck` and `npm run lint` (zero warnings): clean.
- helio-mcp `npm run typecheck`: clean.
- Root jest over `helio-mcp`: 25 suites, 248 tests passed. The evaluator's report did not list this even though helio-mcp changed, so I ran it myself.
- `openspec validate dataset-source-kind-model`: valid.

**UI.** The shared Playwright MCP browser was locked by another session, so I used a separate Chromium via a scratch script against the live servers. Screenshots are in the scratchpad: `manual-light.png`, `manual-dark.png`, `detail-light.png` and `sources-*.png`. The Manual form renders identically in light and dark. The detail and list views show the "Static" badge for dataset sources, as the spec delta says. There is no visual change beyond the discriminator, as intended. The console errors were two 401s from before login, which are not caused by this diff.

### Verdict: CONFIRM

### Non-blocking notes
- `backend/src/main/scala/com/helio/services/patchsets/RefinementEditShape.scala:263`: the LLM-facing prompt still tells the model to emit `"type": "static"`. It works through the alias, but it will break when the alias is removed. It should be updated when the alias is retired, or as part of HEL-1118.
- `helio-mcp/src/helioApi.ts:456` `createDataSource` still sends `type: "static"`. This is valid write-side, but it is the same future-retirement hazard.
- There is no backend route test that POSTs `type:"dataset"` directly to `/api/data-sources`. AC1 is covered by the frontend now sending `dataset`, the hel910 e2e test, and my live probe, but a one-line `DataSourceRoutesSpec` case would pin it cheaply.
- `DataSourceRepository.rowToDomain`'s `DataSourceKind.Static` arm goes slightly beyond D2's "only canonicalize and the protocol arm" wording. It is defensive and documented, so this is not a defect.
