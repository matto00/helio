## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `c08c92e1b0145acc8bfb2238d189dee006f2e96a` (parent `b9dc1553`, the cycle-1 commit)
Diff base (re-resolved LIVE via `resolve-review-base.sh`, CON-152 — not the cached cycle-1 value):
`e6aaf2f4d740f145a9fd157dce109878d893d419`
This cycle: 9 files, 541 insertions / 12 deletions. Worktree clean; branch confirmed
`feature/form-panelkind-registration/HEL-1083`.

All four cycle-1 change requests are **closed**, both non-blocking suggestions implemented, and the
high-risk CR3 ↔ D9-(iii) interaction is verified **behaviourally** rather than by reading the test.

---

### Phase 1: Spec Review — PASS

**CR1 — Impact list corrected in both directions: VERIFIED.** I re-read the section rather than
grepping it (the orchestrator's own false alarm this cycle came from a substring grep that could not
see the brace-expansion form — the same trap my cycle-1 CR text fell into when it listed
`PanelService.scala` as missing; it was present as
`services/panels/{PanelServiceHelpers,PanelService}.scala` all along, and my CR1 was wrong on that
one sub-point). Reading the section confirms:
- `api/ApiRoutes.scala` — present, with the DI rationale (the check would "silently no-op").
- `services/panels/{PanelServiceHelpers,PanelService}.scala` — present (brace form).
- `infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala` — present, noted as
  mutation-proven load-bearing for AC2.
- Test-support line — present, naming all four scaffolding files, with the note that
  `ApplyProposalSpecBase` changes no existing fixture's behaviour.
- `domain/panels/package.scala` — no longer a phantom entry: explicitly recorded as evaluated
  (task 1.3) and **not needed**, with the reason (`FormPanel.scala` hand-writes its formats rather
  than deriving one needing a `DataSourceId` format in scope). I confirmed independently that the
  file is untouched in the cumulative diff. C12 satisfied.

**CR2 — design.md corrected: VERIFIED.** The Context now reads "The snapshot wire's genericity is
EXPORT-direction only", naming `fromDomain`/`encodeConfig` as the part that needed no change and
`DashboardSnapshotRepository`'s own closed match as the part that did. New **D11** records the
import-side `FormCreate` arm as its own decision, states correctly that it would have surfaced as a
`MatchError` rather than a compile error (the match is non-exhaustive, not sealed-closed), cites
mutation 4.7 as the load-bearing evidence, and tells a future kind's author to check **both** match
sites. That is C9-compliant recording, not assertion.

**CR4 — mutation transcripts persisted: VERIFIED.** `mutation-evidence.md` (117 lines, committed in
the change dir so it survives worktree teardown) carries all three transcripts with the exact
mutation, the command, per-test red/green, the C7 note on why 4.3a stays green, and — commendably —
an explicit reconciliation of the cycle-1 (17/11/6) vs cycle-2 (19/12/7) counts rather than quietly
restating new numbers. It is cited from `files-modified.md`. I accept the orchestrator's correction
that `.concertino/runs/HEL-1083/evidence/` does exist in the main checkout; my cycle-1 wording was
scoped to the worktree and should have said so. CR4 stood on its own merits regardless, since the
transcripts genuinely existed nowhere.

**Acceptance criteria — both halves re-verified on THIS binary.** CR3 sits on the decode path the
import route uses, so I did not carry AC2 forward from cycle 1 on trust:
- **AC1:** a valid `form` create returns 201 with config intact (`step: 2.5`, `required: true`,
  `submit.label`), i.e. no over-rejection from the new strictness.
- **AC2:** `GET /export` → **200**; `POST /import` → **201**; exported == imported byte-for-byte
  (sorted-JSON), field order `['quantity','note','choice','attachment']`, `step: 2.5`,
  `required: true`, `submit {"label":"Add row","resetOnSuccess":true,"writeMode":"append"}`.

**Tasks:** still 34/34 `[x]`, 0 unchecked; this cycle's work was CR-driven, adding no new task rows.

**Constraints (re-read this cycle per CON-161; C1 retired, C2–C12 active):** all satisfied. C8 —
the cycle-1 failure — is now closed at both levels (see Phase 2). C4 re-confirmed at
`PanelRepository.scala:335`/`:355` and re-proven by mutation. C12 satisfied by CR1.

**Issues:** none.

---

### Phase 2: Code Review — PASS

**Gates — all re-run by me on this commit; neither the orchestrator's nor the executor's numbers
were taken on trust.** Every figure is from my own run:

| Gate | Result |
| --- | --- |
| `cd backend && sbt test` | **4605 tests, 310 suites, 0 failed, 0 aborted** — "All tests passed" (395s) |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 — Prettier-clean |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 — helio-mcp **271/271**; frontend **3458/3458** |
| `npm run check:schemas` | exit 0 — 96 / 7 surfaces / 14 surfaces |
| `npm run check:scala-quality` | exit 0 — clean (174 pre-existing soft warnings) |
| `npm run check:helio-mcp-types` | exit 0 |

4605 is exactly +3 on cycle 1's 4602, matching CR3's three new tests — and per MISTAKES.md I checked
that those three actually *ran* rather than inferring it from the delta: all three appear
individually in the run log ("reject an unrecognized top-level config attribute with 400…",
"reject an unrecognized top-level config attribute", "decode an unrecognized stored form_config
TOP-LEVEL attribute as Empty, never throwing"), with 0 canceled / 0 ignored / 0 pending.
`npm --prefix frontend run build` was **not** re-run and is not required: no `frontend/**` file
changed this cycle (the diff is 4 backend files + 5 artifacts), and it passed on cycle 1's identical
frontend.

**Mutation evidence — all three independently re-derived by me on `c08c92e1`, in a throwaway
detached worktree under the scratchpad (never the delivery worktree, where I am read-only).**

- **4.7** (delete `PanelRowMapper.rowToDomain`'s form arm): 0 compile errors, **19 run / 12 passed /
  7 FAILED** — matching the claim exactly. **The delta is explained**, as asked: the 7th red is
  CR3's own new test, "decode an unrecognized stored form_config TOP-LEVEL attribute as Empty, never
  throwing" (`ClassCastException` shape, since the row decodes as `OutputPanel`), and nothing else
  newly broke. C7 still holds precisely — green and unaffected: 4.3a create round-trip,
  no-Output-binding, cross-owner 404, empty-`dataSourceId` 400, all three apply-proposal specs,
  **and CR3's new route-level 400 test** (none re-reads via `rowToDomain`).
- **4.8** (drop `form_config` from both column tuples): 0 compile errors, **11 run / 10 passed /
  exactly 1 FAILED** — task 1.8's PATCH-persistence test, and only it. Export/import, the re-read,
  and CR3's new rejection all stayed green.
- **4.10** (delete `PanelContent.tsx`'s `isFormPanel` branch): baseline 27/27 → **1 failed / 26
  passed** (`Unable to find an accessible element with the role "status"`, mutant rendering
  `panel-content--metric`) → restored 27/27.

The throwaway worktree was removed afterward; `git worktree list` shows no scratchpad stragglers and
the delivery worktree is clean at `c08c92e1`.

**CR3 — the fix itself: VERIFIED in source and behaviourally, in both directions.**
`FormPanelConfig.AllowedKeys = Set("dataSourceId","fields","submit")` is checked **inside**
`read`'s `JsObject` branch *before* any field parsing (`FormPanel.scala:205-216`), mirroring
`FormFieldSpec.read:66-68` and `FormSubmitSpec.read:145-147`. Measured against the running backend:

```
POST /api/panels  config:{dataSourceId, fields:[], submitt:{…}, bogusTopLevel:123}
  → 400 {"message":"Unrecognized form config attribute(s): bogusTopLevel, submitt"}   (was 201 in cycle 1)
POST /api/panels  config:{…, fields:[{sourceField,control,min:0}]}
  → 400 {"message":"Unrecognized form field attribute(s): min"}                        (unchanged)
POST /api/panels  valid form config
  → 201, config intact (step 2.5, required true, submit.label)                         (no over-rejection)
```

That first line is also my proof the restarted backend is running CR3's code, rather than an
inference from class-file timestamps — and I deliberately killed the stale cycle-1 backend first
(verified by pid/cwd, with an explicit refusal guard so I could not touch the concurrently-running
test suite's sbt pids), because `start-servers.sh` reuses an already-healthy server and would
otherwise have silently handed me the old binary.

**The high-risk interaction (CR3 strictness vs D9 layer (iii) tolerance) — NO REGRESSION.** This was
the orchestrator's primary concern and it is the one thing a reading of the test could not settle.
The executor's new unit test is real, but I verified it end to end instead. The fixture had to be
doctored in place via psql, because the new write path now *refuses* to create such a row — the
cycle-1 panel titled "unknown top-level key" was useless as a fixture since the old code stripped
those keys on write:

```
UPDATE panels SET form_config = {... ,"bogusTopLevel":123} WHERE id='d4b9da16-…';   -- jsonb
GET /api/dashboards/1ad45b0d…/export          → 200   (traverses rowToDomain)
  "unknown top-level key" => {"dataSourceId":"","fields":[],"submit":{"writeMode":"append"}}   ← Empty
  "Evaluator Order Form"  => full config, every attribute intact                               ← siblings unaffected
GET /api/dashboards/1ad45b0d…/panels          → 200   (the route the UI uses)
```

Backend log, i.e. the fallback is **logged**, not silent, and names the panel id exactly as D9-(iii)
specifies:

```
WARN c.h.i.p.panels.PanelRowMapper$ - panel d4b9da16-9488-4d78-ad04-718cdaba4861:
  form_config failed to decode (Unrecognized form config attribute(s): bogusTopLevel); falling back to Empty
```

Across every probe in this cycle the backend log contains **0** `ERROR`, **0** `MatchError`, and
**0** 5xx lines. So the silent drop CR3 closed was not converted into an outage.

**A harsher question the unit test doesn't reach, measured:** since the tolerant read yields `Empty`,
the exported snapshot of a corrupted panel carries an empty `dataSourceId` — so re-importing it is
**rejected loudly** rather than silently creating a broken panel:
`400 {"message":"panel 'd4b9da16-…': dataSourceId is required"}`. Correct per D5, and it names the
offending panel. See the non-blocking note below on its one real consequence.

**A risk I hunted because CR3 widened strictness beyond the tested caller — resolved, executor
clear.** CR3 made `FormPanelConfig.read` strict for *every* caller, and `PanelRowMapper`'s catch
protects only its own path. If any other read path decoded a stored `form_config`, an unknown
top-level key would 500 there instead. I enumerated all callers: `PanelConfigCodec:55`
(`decodeCreate`, write path → 400 via `safe`), `PanelRowMapper:130` (the protected read path), and
`FormPanel.scala:355` (`companion.readConfigFromWire`, **uncaught**). The last one is benign:
`readConfigFromWire` and `writeConfigToWire` have **zero call sites** anywhere in main or test,
`Panel.companionFor` has **zero callers** (every `companionFor` hit belongs to `PipelineStep`, a
different ADT), and `Panel.Registry` is consumed only via `keySet` for error strings and
`PanelKind.All`. All six panel kinds do the identical uncaught decode, so this is pre-existing
symmetry, not something CR3 introduced. Recorded as a non-blocking observation only. Separately I
confirmed every panel read funnels through `PanelRepository.rowToDomain` → `PanelRowMapper`
(`PanelRepository.scala:27-28`, `DashboardRepository.scala:27`), which does carry the catch.

**Both non-blocking suggestions implemented, correctly:**
- `FormSubmitSpec.read`'s `case JsNull => Default` is gone; `"submit": null` now falls to
  `deserializationError(s"submit must be an object, got $x")` like any other non-object, with a
  comment citing the reason. No test regressed (4605 green).
- `decodeCreate` carries a comment explaining why it is a distinct name from `decode` (a stable
  write-path seam if create-only rules are added later) — exactly the rationale I suggested.

**Code quality:** the diff is small, well-commented, and every comment is accurate (I checked the
`additionalProperties: false` claim against `schemas/panels/panel.schema.json` — correct, so backend
and published contract now agree). `FormPanel.scala` grew 338 → 356 lines: still under
CONTRIBUTING.md's ~400 propose-a-split line, and my cycle-1 ruling stands — the length is
hand-written strict codecs, which is what makes C8 explicit. No TODO/FIXME, no new type escape
hatches, no inline FQNs (`check:scala-quality` clean).

**Issues:** none.

---

### Phase 3: UI Review — PASS

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed this cycle
(the diff is 4 backend files + 5 artifacts), so the UI surface is byte-identical to the cycle-1
commit that already passed. The frontend dev server was legitimately reused for that reason; the
backend was restarted on the new commit. `assert-phase.sh servers` → **PASS servers**, and
`location.href` was re-checked before every reading (parallel-Playwright hazard).

I still re-ran the user-facing half, because CR3 changed the read path the UI consumes:

- **The doctored panel renders benignly.** With all three panels placed in the dashboard layout
  (via a `PATCH` using the correct `panelId` item shape — my first attempt 400'd on my own malformed
  `i` key, which was my error, not the app's), the dashboard rendered **3** articles —
  "Evaluator Order Form", **"unknown top-level key"** (the corrupted row), "c2 valid form" — each
  showing the placeholder, with `.panel-content--metric` count **0** and no error boundary.
- **Computed accessible names (HEL-1005), not DOM presence.** The a11y tree gives each panel
  `status` → "Form not configured":
  ```
  article: heading "Evaluator Order Form"   → status: Form not configured
  article: heading "unknown top-level key"  → status: Form not configured
  article: heading "c2 valid form"          → status: Form not configured
  ```
- **No console errors:** 3 messages total, **0 errors / 0 warnings** (React DevTools info notices).
- The render re-exercised the tolerant path — the backend's WARN count for `d4b9da16` rose to 4 at
  `14:05:35`, matching the page load, with still zero ERROR/5xx.

Worth stating plainly rather than glossing: before I placed the panels, only 1 of 3 rendered
(all four `layout` arrays were empty). That is pre-existing placement behaviour, unrelated to this
change — cycle 1 showed the same 1-article render with 2 panels, and a `form` panel gets no
server-owned layout item by design (HEL-909 decision-15 grants default placement to `output` panels
only). It is not a defect of HEL-1083, and HEL-1084 (the builder) is where a form panel first gets
an authoring path that would place it.

---

### Overall: PASS

All four cycle-1 change requests are genuinely closed — verified by reading the corrected artifacts
and by re-running everything, not by accepting the claims. Every gate is green on my own fresh run
(4605/310/0), all three mutations re-derive exactly as documented with the 4.7 delta explained by
CR3's own new test, both AC halves are re-verified behaviourally on this binary, and the one
interaction that could have made this cycle worse than cycle 1 — strict decode meeting the tolerant
read path — is measured safe end to end: 200 on read, `Empty` config, a logged warning naming the
panel id, zero 5xx, and a dashboard that still renders in the browser.

### Change Requests

None.

### Non-blocking Suggestions

- **One corrupted form panel makes its whole dashboard un-importable.** Because the tolerant read
  degrades the panel to `Empty` and `Empty` is invalid under D5, `export → import` of a dashboard
  containing such a row fails wholesale with `400 panel '<id>': dataSourceId is required` — the
  healthy panels alongside it cannot be imported either. This is loud rather than silent (correct,
  and consistent with D1's stated "cannot be PATCHed without resupplying `dataSourceId`"), and it
  needs no change here; the message even names the offending panel. Flagging it as a known
  consequence worth a line in the PR body, since the only recovery is editing the stored JSONB.
- **`FormPanel.scala:355`'s `readConfigFromWire` remains an uncaught strict decode.** Harmless today
  (zero call sites, and all six kinds are symmetric), but it is now the one place where a stored
  config could be decoded without the tolerant wrapper. If a future ticket ever routes a read
  through `Panel.Registry`, that is the line that turns a rolled-back row into a 500. Cheapest
  durable guard would be a comment at that definition pointing at `PanelRowMapper.formConfig` as
  the tolerant caller. Not actionable in this change.
- `mutation-evidence.md` is a genuinely good artifact — specific, reconciled against the earlier
  counts, and honest about why it did not exist before. Worth keeping as the template for future
  C2 evidence in this repo.

### Environmental notes (recorded, not defects)

- **RLS is unverifiable locally, and I am not implying otherwise.** Dev and CI run as superuser
  (BYPASSRLS), so V108's `NO FORCE`/`FORCE ROW LEVEL SECURITY` bracketing is applied but its RLS
  semantics are **not exercised** by anything I ran, this cycle or last. Per D2 the migration adds
  no policy and no table, so residual risk is low — but unverified by construction.
- Backend tests use zonky EmbeddedPostgres (fresh per run, random port), so the shared-dev-DB Flyway
  collision hazard did not apply to any gate run. V108 remains applied to the shared dev DB from
  cycle 1 (`installed_on = 13:20:06`), which is the correction the orchestrator accepted.
- **Shared dev DB state I created, disclosed rather than cleaned** (destructive pattern-matched
  cleanup in a shared DB is not something I'll do unasked; the orchestrator has said it will rule at
  Phase-4 hygiene): dashboards `1ad45b0d-…` (now holding 3 form panels, layout populated by my
  `PATCH`) and `56c55eb0-…`, plus this cycle's additions — panel `7188f13c` ("c2 valid form"), a
  second imported dashboard from the AC2 re-check, and panel `d4b9da16` whose `form_config` I
  **deliberately doctored** to `{…,"bogusTopLevel":123}` to build the D9-(iii) fixture. That last
  row is intentionally invalid: it reads fine (degrades to `Empty` + WARN) but its dashboard cannot
  be re-imported until the row is fixed or removed.
- Two of my own probe errors are recorded above for completeness: a `::text` cast on a `jsonb`
  column, and an `i`-keyed layout item where the schema requires `panelId`. Neither reflects on the
  implementation.
