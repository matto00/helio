## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: `c08c92e1b0145acc8bfb2238d189dee006f2e96a` (HEAD at the moment I finished reading the diff).
Diff base resolved LIVE (CON-152, exit status checked): `e6aaf2f4d740f145a9fd157dce109878d893d419`.
47 files, 3310 insertions. Cold spawn; every conclusion below is from evidence I ran myself. The
executor's and evaluator's reports were read as claims only.

### What I verified (with evidence)

**Spawn-cwd guard.** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/form-panelkind-registration/HEL-1083`.

**Servers are this worktree's, and the backend is THIS binary — not a stale reuse.**
`start-servers.sh` reported "already healthy ... reusing" for both, which is exactly the disclosed
hazard, so I did not trust it:
- `/proc/<pid>/cwd` for :9422 → `<worktree>/backend`; for :6515 → `<worktree>/frontend`.
- `assert-phase.sh servers` → `PASS servers`.
- Behavioural proof of the commit: the CR3 top-level strictness check (added only in `c08c92e1`)
  returns 400 live. A cycle-1 binary would have returned 201. That is content-based proof of which
  code is running, not a timestamp inference.

**Acceptance criteria — both halves verified by me over real HTTP, on a dashboard I created.**
Created `form` panel with four ordered fields exercising `step`/`required`/`label`/`placeholder`/
`helpText`/`initialValue`/`options`/`file`, then exported and re-imported:
```
CREATE_HTTP:201  EXPORT_HTTP:200  IMPORT_HTTP:201
create type: form            imported type: form
AC1 sent==created : True
AC2 sent==exported: True
AC2 sent==imported: True
field order: ['quantity','note','choice','attachment']
step/required: 2.5 True
submit: {"label":"Add row","resetOnSuccess":true,"writeMode":"append"}
```
Byte-identical on sorted-JSON compare in all three directions. No `MatchError`, no 5xx.

**Validation behaviour I probed directly (not read from a test):**
```
unknown top-level key   → 400 Unrecognized form config attribute(s): bogusTopLevel, submitt
unknown field attribute → 400 Unrecognized form field attribute(s): min
required: false         → 400 requiredness may only be tightened
step on a text control  → 400 step is only valid alongside control: number
submit.writeMode replace→ 400 writeMode must be 'append'
unowned dataSourceId    → 404 Data source not found   (not 403, not 500)
typeless POST /api/panels → type = divider            (PanelType.Default untouched — the ticket's constraint)
```

**Gates re-run by me from scratch (not inherited):**
| Gate | Result |
| --- | --- |
| `sbt testOnly` FormPanelRoundTripSpec + FormPanelSpec + PanelRowMapperSpec + PanelTypeSpec + PanelSpec | **95 tests, 5 suites, 0 failed / 0 canceled / 0 ignored / 0 pending** |
| `npm run typecheck` | exit 0 |
| `npm run check:schemas` | exit 0 — 96 across 50 protocol files, 7 panel-type surfaces, 14 assistant surfaces |
| frontend jest (PanelContent/mobilePanelHeights/panelNarrowing) | **36 passed / 36 total** |
I did not re-run the full 4605-test backend suite; the evaluator pasted its own full-run output for
both cycles and my targeted run covers every suite this change adds or touches.

**Iron Law — Debugging.** No bug-fix claim is load-bearing here, but the two silent-degradation
traps this change closes are both mutation-proven, and I checked the mutations are *failable* rather
than trusting `mutation-evidence.md`: the 4.7 transcript's predicted C7 nuance (4.3a stays green
because `PanelRepository.insert` echoes the in-memory panel and there is no authenticated GET) is
consistent with the spec source I read at `FormPanelRoundTripSpec` and with `PanelService`'s create
path. `mutation-evidence.md` is specific, reconciles its cycle-1 vs cycle-2 counts, and is honest
about why it did not previously exist.

**Claimed deferrals are genuinely untouched** (C9). `git diff --name-only` over the live base for
`PanelPacker|PanelDetailModal|RefinementEditShape|placements` → `NONE TOUCHED`.

**UI / design judgment — my own, in the running app, both themes.**
- Desktop 1440x900. `location.href` re-checked before every reading (parallel-Playwright hazard).
- Dark: `sk-form-dark-1440.png` → `/home/matt/Development/helio/.concertino/runs/HEL-1083/evidence/sk-form-dark-1440.png`
- Light: `sk-form-light-1440.png` → `/home/matt/Development/helio/.concertino/runs/HEL-1083/evidence/sk-form-light-1440.png`
- Computed accessible name asserted from the a11y tree, not DOM presence (HEL-1005):
  `status` → "Form not configured". `.panel-content--metric` node count **0** in both themes, so the
  D10 wrong-render does not occur in the real app.
- **Token compliance measured, not inspected.** Label color resolves to exactly
  `--app-text-muted` in each theme (dark `rgb(170,164,156)` == `#aaa49c`; light `rgb(100,94,86)` ==
  `#645e56`), `inlineStyle` is `null`, wrapper background transparent, font Schibsted Grotesk per
  DESIGN §4. No new CSS at all — it reuses the `.panel-content panel-content--state` +
  `.panel-content__state-label` recipe that seven sibling states already use in this same file and
  two renderers, with `role="status"` matching the "Not run yet" sibling verbatim.
- **Light/dark parity holds.** No accent tinting, hairline card border, mono `FORM UPDATED …`
  footer consistent with sibling panels, no horizontal overflow, 0 console errors / 0 warnings
  across the whole session.
- **On DESIGN §7's "Empty: render `EmptyState`":** I am not raising it, and this is my call rather
  than a deferral to the evaluator's. `EmptyState` is the recipe for data-backed *views/sections*;
  in-panel content states have their own established shared recipe in this exact file, and matching
  the seven siblings is the correct cohesion decision. Introducing `EmptyState` inside a grid panel
  here would be the off-pattern choice.

### The five judgment calls I was asked to make

1. **A corrupted form panel makes its whole dashboard un-importable — acceptable, no mitigation
   owed.** The behaviour is loud, names the offending panel (`400 panel '<id>': dataSourceId is
   required`), and is correct per D5. Decisive point: **the shipped write path can no longer create
   such a row** — CR3 made unknown top-level keys a 400, which I confirmed live. The state is
   reachable only by out-of-band JSONB editing or a future-version-then-rollback, and in both cases
   failing loudly beats importing a silently-broken panel. A code mitigation (per-panel skip)
   would reintroduce exactly the silent-degradation family this capability exists to close. I do
   **not** require a spec scenario as a blocker: the tolerant-read scenario already records the
   `Empty` degradation, and the import consequence follows from it plus the existing
   missing-`dataSourceId` scenario. It does belong in the PR body — see notes.
2. **`FormPanel.scala:355` is not a latent trap handed to HEL-1084/1085.** I verified the symmetry
   claim rather than accepting it: `grep readConfigFromWire` shows **all six** kinds do the identical
   uncaught decode (`OutputPanel:83`, `TextPanel:81`, `ImagePanel:122`, `MarkdownPanel:81`,
   `DividerPanel:118`, `FormPanel:355`). So this is pre-existing shape, not something this change
   introduced, and a future caller routing reads through `Panel.Registry` would inherit the same
   exposure for every kind — a cross-kind concern, not a form-panel debt. Recording it is enough.
3. **The round-trip AC is genuinely discharged, not redefined.** Half two is unambiguous: export →
   import is a complete round-trip through a real read path (export traverses `rowToDomain`) and I
   measured it byte-identical. Half one is create-response plus a repository-level re-read because
   `PanelRoutes` genuinely exposes no authenticated per-panel GET — that is the strongest read the
   API affords, the export path independently proves the stored row decodes correctly, and the
   capability spec discloses the caveat in the scenario text rather than hiding it. Honest.
4. **Scope is clean and nothing is foreclosed.** The diff is tight; every production file outside
   the original Impact list is mechanically required (`ApiRoutes` DI — without it D6's check
   silently no-ops; `PanelService` is task 1.10's substance; `DashboardSnapshotRepository` is what
   AC2 depends on). **D10 was the right call**, and not merely a defensible one: `form` is
   API-creatable as of this change, so without that branch a real form panel renders as a metric
   with `tsc` and Jest both green — I confirmed 0 metric nodes in the live app, and the branch is
   mutation-proven failable. Forward compatibility is preserved deliberately: `submit` is an object
   (HEL-1087/1088 can extend without a wire break), `step` is already in the closed attribute set
   (HEL-1088's counter needs no delta to either set), and `control` orthogonality keeps HEL-1084's
   author-time check possible at all.
5. **The artifacts represent the incomplete agent path honestly.** It is stated in proposal.md's
   Non-goals, recorded as design D7 with the coordinator ruling quoted, and — the part that matters
   most — written into the capability spec as its own requirement with four scenarios covering both
   the loud-400 no-config shape and the successful `config.dataSourceId` passthrough, including the
   cross-owner rejection. Nothing is buried. C6's correction of the retired C1 is carried through
   consistently; I found no artifact still claiming an agent-proposed form cannot bind a source.

**Disclosures I was asked to re-check rather than trust:**
- `PanelService.scala` **is** present in proposal.md's Impact list in brace form
  (`services/panels/{PanelServiceHelpers,PanelService}.scala`). I read the section rather than
  grepping it. The orchestrator's retraction is correct.
- V108 applied to the shared dev DB: not load-bearing for anything I measured — backend tests use
  ephemeral embedded Postgres, and my live probes ran against the already-migrated dev DB.
- `design.md` over the 150-line advisory budget and `FormPanel.scala` at 359 lines vs
  CONTRIBUTING.md's ~250 soft / ~400 split threshold: **I concur with both trades.** I read
  `FormPanel.scala` in full — the length is three hand-written strict codecs whose per-key match arms
  are what make C8's strictness and its error messages explicit. Splitting three co-dependent types
  across files would cost cohesion for no benefit. Cutting gate-mandated D9/D10/D11 content to hit
  an unenforced line budget would make the artifact worse.
- **RLS was not validated and I am not implying it was.** Dev and CI run as superuser (BYPASSRLS),
  so V108's `NO FORCE`/`FORCE ROW LEVEL SECURITY` bracketing is syntactically applied but its RLS
  semantics are exercised by nothing I ran. Per D2 the migration adds no policy and no table.

**Gate-defect check (CON-160).** No report under review disclosed unsound evidence-directory mtimes,
and no conclusion of mine rests on mtime ordering or directory placement — every load-bearing
finding above is content-based (my own command output, live HTTP responses, computed styles,
cited line numbers). No gate defect to record.

### Verdict: CONFIRM

Five design-gate rounds and two execution cycles produced a change whose every risky seam is
mutation-proven and whose two behavioural ACs I re-verified myself over real HTTP. The one code
defect found in cycle 1 (the C8 top-level silent drop) is genuinely closed, and the interaction it
could have broken — strict write vs tolerant read — degrades loudly and visibly with zero 5xx. Ships.

### Non-blocking notes

1. **The PR body should carry two lines, or the honesty of this change decays after merge:** (a) the
   knowingly-incomplete agent path (`form` proposable but never suggested; no first-class
   data-source field; tracked by the coordinator-filed follow-up), and (b) the corrupted-panel
   consequence from judgment call 1 — one undecodable `form_config` blocks its whole dashboard's
   import, and the only recovery is editing the stored JSONB.
2. `FormPanel.scala:355` would benefit from a one-line comment pointing at `PanelRowMapper.formConfig`
   as the tolerant caller. Cosmetic; applies equally to the other five kinds, so arguably a
   separate sweep rather than this ticket's work.
3. Shared-dev-DB residue is now larger, and I added to it: dashboard
   `0d77b531-68e4-4856-a008-4073167fd521` ("Skeptic AC Probe HEL-1083") plus its imported copy and
   ~7 panels from my AC and rejection probes. I did **not** clean it, and I did **not** touch panel
   `d4b9da16`'s deliberately-invalid row — destructive ops in a shared DB are not done unasked.
   Phase-4 hygiene should rule on the whole set at once.
4. I left the browser's `helio-theme` set to `light` (it was `dark`) to test parity. Harmless local
   state, disclosed so nobody misreads a later screenshot's theme.
5. Evidence-hygiene disclosure about my own artifact: my first capture was saved as
   `sk-form-light.png` but was in fact **dark theme at a ~375px viewport** — I mislabeled it. It is
   persisted at `.concertino/runs/HEL-1083/evidence/sk-form-light.png` and should be ignored in
   favour of the two correctly-named 1440px captures cited above. Recording this rather than quietly
   letting a wrong filename stand as evidence.
