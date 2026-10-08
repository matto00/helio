## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: a477e9be5ae2af11e35182131c0cb8f86336bea5. Diff base: e4289e6c88e4d8d0c174b94f1359817fe0466514, resolved live with `resolve-review-base.sh`; it equals origin/main.

### Summary

The code fix is sound and I verified it independently. The `Select` listbox now flips above its trigger or caps its height to stay inside the viewport. The hel1351 assertion is now scoped to the tooltip and checks the east value/baseline pair (15 and 11).

The verdict is FAIL anyway. The acceptance criteria require root-cause and classification *evidence to be stated*, and three tasks (1.2, 2.1, 3.1) are ticked `[x]` while the records they require exist nowhere in the change. Every change request below is cheap to fix. None asks for a code redesign.

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1: hel1350 reproduced locally on main; root cause from the trace and backend log, stated with evidence | **Partial.** See 1a. |
| AC2: midnight pattern verified or refuted; date dependence explained | **Partial.** See 1b. |
| AC3: fix does not weaken either spec | PASS. See 1c. |
| AC4: PanelCard 3-vs-2 classified with evidence | **FAIL.** No classification appears anywhere in the diff, `files-modified.md`, the commit message or the scratch logs. Task 3.1 is still marked `[x]`. |
| AC5: CI e2e 4 legs green | Not yet applicable (orchestrator, delivery phase). |
| Tasks match implementation | **FAIL.** 1.2 (record the bisection evidence), 2.1 (record `tallCard.textContent()` on both sides plus the matching substring) and 3.1 (record the conclusion) are ticked with no record. |
| Scope creep | None. |
| Regressions | None found. The Select fit case is unchanged when the panel fits below (live-probed, see Phase 3). |
| Spec delta | Present: `specs/shared-popover-touch-targets/spec.md` ADDED requirement. `skip_specs` was correctly dropped because this is a user-visible product fix. |
| Constraints C1 and C2 | Met in substance; C2's red-run trace was not retained. See 1d. |

**1a. Claim: the hel1350 red-on-main came from a new viewport assertion, not from reproducing CI's 150s hang. Verified TRUE.** `hel1350-red-main.log` fails at the new `spec.ts:174` `listbox bottom inside the viewport` (981 > 900) after 4–5s. It never reached CI's click hang. The red is also staged: the spec now forces the trigger to the bottom with `scrollIntoView({block:"end"})` and a `y > 700` poll.

- **Acceptable under C2 and Decision 5.** The red is a genuine product state: a fixed-position listbox ending at 981px in a 900px viewport cannot be scrolled into view. That is exactly what the CI trace says ("element is outside of the viewport", 273 times in `art1350/tr/1-trace.trace`). The new assertion is strictly stronger than "the click eventually succeeds".
- **The forced placement has partial support in CI's own trace.** I found one `element is not stable` followed by `retrying click action` on the Compare-trigger click in `art1350/tr/1-trace.trace`, which supports the spec comment's claim that Playwright's retry re-aligned the trigger.
- **Not acceptable as AC1 as written.** Nothing records:
  - that the unmodified spec was ever run on main locally, or what it did;
  - the task 1.2 bisection confirming or refuting HEL-1331, HEL-1285 or HEL-1366, i.e. why PR #829 was green and main red.

  `files-modified.md` gives the cause in one clause, with no evidence.

**1b. hel1351 date dependence.** The cause is plausible and I partly corroborated it. In the executor's `zz-mut-dateleak` run, the card rendered `Updated 10/7/2026` three times while the UTC date was already 10/8. So the label is formatted in the browser's local zone (PDT here), which matches CI in UTC flipping at 00:00Z.

The before/after reproduction that task 2.1 requires was never run: the old `\b(15|7)\b` assertion green where the zone renders 10/7 and red where it renders 10/8, using `timezoneId` or a controlled-`lastUpdated` probe. The skeptic's timezone window closes at about 2026-10-08T11:00Z. After that, the DOM-probe route applies.

**1c. AC3.**
- hel1350 keeps every original assertion and adds one.
- hel1351 replaces a bare whole-card `\b(15|7)\b` with an anchored, tooltip-scoped east pair `^east.*sum\(amount\)\s*(?<!\d)15(?!\d).*vs 7d\s*(?<!\d)11(?!\d)`. That is strictly stronger. The old assertion was justifiably wrong: its haystack included the date label.

**1d. C1 and C2.**
- C1:
  - Tooltip-scoped (`.chart-tooltip`): yes.
  - Digit boundaries: yes.
  - Deterministic category: yes. East is pinned by the `^east` poll filter, with the 15/11 pair.
  - Wrong-value mutation (10): red, per `hel1351-mut-wrongvalue.log`.
- **Claim: the "date-leak" mutation only changed the expected value to 7 and never ran an actual Updated-date leak. Partly wrong.**
  - It did only change the expectation to 7.
  - But during that run the card *did* contain the leak text `Updated 10/7/2026`. Durable evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/test-results/zz-mut-dateleak-aggregated-a44ec-y-and-compact-legend-light-/error-context.md`, lines 97, 114 and 145.
  - So the run exercised design 2(c) literally: the card contains `Updated 10/7/2026`, the tooltip disagrees with the expected value, and the assertion stays red.
  - I accept C1 as met. The executor never stated this, so the artifacts must say it (CR3).
  - Caveat: the run does not isolate the scoping. The `^east` anchor alone would also have kept it red. Both defences are real, so this is not a defect.
- C2:
  - Red-on-main and green-on-fix e2e: present.
  - `evidencePath` screenshots: present. I persisted them (see Phase 3).
  - Full logs: present in the scratchpad.
  - The **red-run traces are gone.** `test-results/` has since been overwritten and only the zz-mut trace survived. C2 requires the trace (CR1).

**1e. Claim: Decision 2's report-only grep of other e2e specs for the loose-digit whole-card pattern was not done. Verified TRUE** (nothing in any artifact).

The omission is low-impact. My own grep found no hits:
- `grep -nE '\\b\(?[0-9]' e2e/*.ts` returned nothing.
- The remaining whole-card `textContent()` sites assert label text only, not digits: `hel1275:223`, `hel1277:312/317`, `hel1350:214/227`.

It still has to be recorded as Decision 2 requires (CR4).

**1f. Claim: test users were left undeleted. Verified TRUE, but this was not introduced by this diff.** Both specs on main already log `created user <id>` and delete only the dashboard, pipeline and source in `finally` (main `hel1350-chart-compare-picker.spec.ts:201-210`). There is no user deletion. The executor's local runs left the users listed in its logs, about 14. My own verification runs left 6 more, listed in CR5. The standing rule (delete by exact id) applies to the run's residue, not to the code (CR5).

### Phase 2: Code Review — PASS

I ran the gates fresh in `WORKTREE_PATH`, at `nice -n 19` with 3 workers. Logs are in `scratchpad/eval/`.
- `npm run lint`: 0.
- `npm run format:check`: 0.
- `npm run typecheck`: 0.
- `npm test`: 463/463 suites, 4891/4891 tests (plus 39/39 suites, 378 tests).
- `npm --prefix frontend run build`: 0.
- No backend files changed, so no `sbt testFull`.

Code review:
- **Correctness.** `Select.tsx:135-153` runs in a `useLayoutEffect` (measure, then write before paint).
  - React controls `style.top`. It only rewrites it when `panelPos.top` changes, and then the effect re-runs and overrides it again. `maxHeight` is not React-controlled.
  - The panel unmounts on close, so no state leaks between opens.
  - The `scrollHeight === 0` guard keeps jsdom suites unaffected; the 4891-test run is green.
- **`selectPanelFit.ts`.** A pure function with 5 Jest cases. They are labelled "geometry only, not layout proof", as Decision 5 and C2 require.
- **DESIGN.md [mechanical].** The inline `style` writes are popover positioning, which DESIGN.md:63 explicitly permits. No hardcoded colours, spacing or font literals.
- **Type safety.** No `any`. The test cast `option.tooltip as { className?: string }` is narrow and fine.
- **Security and error handling.** Not applicable (pure UI geometry).
- **Tests are meaningful.**
  - The e2e listbox-bounds assertion went red on main and green on the fix.
  - The hel1351 pair assertion was mutation-checked.
  - `chartAppearance.test.ts` pins the `chart-tooltip` hook the e2e depends on.
- **Dead code and over-engineering.** None.

### Phase 3: UI Review — PASS

- Servers: `start-servers.sh` and `assert-phase.sh servers` PASS. They are this worktree's: vite cwd `HEL-1373/frontend`, backend cwd `HEL-1373/backend`, and the served `Select.tsx` contains `fitSelectPanel`.
- Fresh e2e run, browser zone PDT (renders 10/7): hel1350 light and dark plus hel1351 light and dark, 4/4 passed (`scratchpad/eval/e2e-pdt.log`).
- Fresh e2e run with `TZ=UTC` (renders 10/8): hel1351 2/2 passed (`scratchpad/eval/e2e-utc.log`). The new assertion is green on both sides of the date boundary.
- Evidence screenshots, persisted: the open listbox flipped above the trigger, all 5 options (None, Previous, 1 day, 7 days, 30 days) inside the 900px viewport.
  - `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/e2e-evidence/HEL-1373/compare-listbox-open-light.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/e2e-evidence/HEL-1373/compare-listbox-open-dark.png`
- Live probe of a different `ui-select` consumer (the dashboard's "Region" select):
  - 768x260: the trigger bottom is at 201. The listbox flipped to top 11 / bottom 153 with `max-height: 142px`, so it is fully inside the viewport.
  - 1440x900: it opens directly below (trigger bottom 178, listbox top 182) at its natural height. The unchanged fit path is confirmed.
- No console errors during the probe.
- Accessible names and keyboard handling are unchanged.

### Overall: FAIL

### Change Requests
1. **AC1 / task 1.2 / C2: record the hel1350 root-cause evidence.**
   - In `files-modified.md` (or a short `root-cause.md` in the change dir), state:
     - (a) what the **unmodified** main spec does locally: hang, pass, or pass flakily;
     - (b) the CI trace evidence that the Compare-trigger click hit `element is not stable` and then a retry, which is the basis for the forced bottom placement in `e2e/hel1350-chart-compare-picker.spec.ts:146-167`;
     - (c) the task 1.2 attribution: bisect HEL-1331 (`HistoryPayloadsField`), HEL-1285 (+"Previous") and HEL-1366, or state explicitly why bisection was not done and why the fix does not depend on it.
   - Re-run the red-on-main case and **persist the trace** with `persist-evidence.sh`. The earlier red traces in `test-results/` are gone.
2. **AC2 / task 2.1: run and record the before/after date reproduction.**
   - Run the OLD whole-card `/\b(15|7)\b/` assertion under a browser zone that renders the server instant as the 7th (green) and as the 8th (red), using `timezoneId`, or use a PanelCard probe with a controlled `lastUpdated` if the zone window (about 2026-10-08T11:00Z) has passed.
   - Record both full `tallCard.textContent()` strings and the substring that matched.
3. **C1 record.** In `files-modified.md`, state that the `zz-mut-dateleak` run had `Updated 10/7/2026` in the card (cite the persisted `error-context.md` ref above), and that the assertion stayed red with the leak text present. As currently described, the mutation reads as a second wrong-value check.
4. **Decision 2: record the e2e grep.** Add the command and its result to the change record: zero loose-digit whole-card assertions. The remaining whole-card `textContent()` sites (`hel1275:223`, `hel1277:312/317`, `hel1350:214/227`) assert text labels only.
5. **Test-data residue.** Delete, by exact id, every user created during this run's local e2e runs, or record why they cannot be deleted and leave a follow-up.
   - The executor's ids are in `scratchpad/logs/hel13{50,51}-*.log`.
   - The evaluator's runs created `e20dbfd7-dca3-4689-818b-c2dc29e15c4f`, `5dd9197c-5b6f-4b8a-8d37-a1cbe61698c9`, `7feb12f8-c69e-405c-b6ba-4f1bd05b6631`, `c2e2f64c-e263-4a34-b958-d3340685d0d2`, `9af6bfdd-6122-49b5-bf47-d82d97eb2965` and `e13de37b-d020-403e-a615-fcaba114c7a9`.
   - The specs' user-less cleanup predates this diff and is not a code change request here.
6. **AC4 / task 3.1: classify the PanelCard.test.tsx 3-vs-2 observation.** Record it as related to this change or HEL-1215's flake, with the bounded repeat-run counts and the code reading behind it. Otherwise untick 3.1.

### Non-blocking Suggestions
- `e2e/hel1350-chart-compare-picker.spec.ts:158,173-176`: derive `700` and `900` from `page.viewportSize()` instead of literals.
- `frontend/src/shared/ui/selectPanelFit.ts:2`: `VIEWPORT_MARGIN = 8` duplicates the same constant in `frontend/src/hooks/usePortalPopover.ts`. Consider exporting one.
- `selectPanelFit.ts:27-29`: when both `above` and `below` are negative (trigger off-screen), `fitted` can go negative. Clamp it with `Math.max(fitted, 0)` for symmetry with the below branch.
