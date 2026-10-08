## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/main-e2e-red-hel1350-hel1351/HEL-1373`. Worktree HEAD is e4289e6c8 (current main tip), and the only untracked path is the change dir.
- **hel1350 trace claim holds.** In `art1350/tr/1-trace.trace`, `element is outside of the viewport` appears 273 times, all on `callId call@86`. `test.trace` names that step `Click getByRole('option', { name: '7 days' })`. The call log contains `<button role="option" class="ui-select__option">7 days</button>`. The spec has that click at `e2e/hel1350-chart-compare-picker.spec.ts:149`, after the "Previous" `toHaveCount(1)` check at :148, as the design says. The viewport is 1440x900 (spec :39). The CI log shows both themes failing with `✘ ... (2.5m)` and the reported error at `:206` (cleanup).
- **PR #829 ancestry claim holds.** `git merge-base --is-ancestor`: b14e622ee is NOT in d18c9b8a5, f268edf8f is NOT in d18c9b8a5, and 36b074f27 IS in it. f268edf8f does add `HistoryPayloadsField.tsx` to the Output editor. The failing trace DOM also contains that field's help text (`7 days; Owner keeps 30 runs for 30 days.`), so the field rendered in the failing sheet. The layout hypothesis is a plausible candidate, and the design correctly calls it unconfirmed and requires local bisection (task 1.2).
- **hel1350 Decision 1 is sound.** It prefers a product fix when a pointer user is affected. It rejects force-click, dispatchEvent and viewport enlargement as default bypasses. It requires a unit test that fails on the old layout.
- **Root of the hel1351 date dependence, found by code reading.** `frontend/src/features/panels/ui/PanelCard.tsx:840` renders `Updated {new Date(panel.meta.lastUpdated).toLocaleDateString()}`. The spec asserts against `tallCard.textContent()`, the whole card, so this label is in the haystack. With the en-US locale it renders `10/7/2026` before midnight UTC, and the `/` characters give `7` word boundaries. Node probe: `/\b(15|7)\b/` matches `"…sum(amount)15vs 7d11Updated 10/7/2026"` (true) and does not match `"…Updated 10/8/2026"` (false). So before midnight the assertion was most likely satisfied by the date, not by the grouped value. That supports the design's candidate. The important detail is that the date comes from a **server** timestamp (`panel.meta.lastUpdated`).
- **Also observed:** the hel1351 run in this same CI job passed at 23:38Z on 10-07 (before midnight), which fits the reported midnight boundary.

### Verdict: REFUTE

### Change Requests

1. **Task 2.1's reproduction method cannot reproduce the most likely cause. Add a method that can.**
   - **The problem:** task 2.1 and the design Goal ask for "a faked browser clock (`page.clock`) on each side of 2026-10-08T00:00Z". The date text that satisfies the regex is `Updated <date>` from `panel.meta.lastUpdated` (PanelCard.tsx:840). That is a **backend-assigned** timestamp, formatted in the browser's time zone. Faking the browser clock does not change it. An executor following the task literally will see no difference across the faked midnight and could wrongly conclude the date dependence is refuted (AC2).
   - **Required revision:** update design.md (Goals plus the Risks entry on faked clocks) and task 2.1 to say what to do when the date text comes from the backend. Acceptable options:
     - Emulate the browser time zone with Playwright `timezoneId` (e.g. `America/Los_Angeles` against today's server timestamp) so the same server instant renders as the 7th and as the 8th.
     - A PanelCard unit/DOM probe with a controlled `lastUpdated`.
   - **Required evidence:** the full `tallCard.textContent()` on both sides, plus the exact substring that matched `\b(15|7)\b`.
2. **Decision 2's example "strictly stronger" assertion fails on the observed text. Fix the example and pin the hover target.**
   - **The broken example:** design.md Decision 2 suggests `/sum\(amount\)\s*15\b/`. The tooltip text given in the ticket is `sum(amount)15vs 7d11`. There is no `\b` between `15` and `vs` (both are word characters). A Node probe shows this regex returns **false** on that text, so the suggested fix would be red against correct output.
   - **The hover problem:** the spec's hover poll (`spec.ts` ~:236-246) returns the first x-position whose card text contains `vs 7d`. That can be the west bar (value 7, baseline 9), not east (15, baseline 11). The current regex deliberately accepts either value. A 15-only assertion is only valid if the hover is pinned to the east category.
   - **Required revision:** revise Decision 2 so that:
     - (a) the example assertion is valid against the real text, e.g. digit-boundary `15(?!\d)` / `(?<!\d)15(?!\d)`, or better, scope to the tooltip element instead of the whole card so the `Updated` date and other card text are excluded;
     - (b) the spec deterministically targets the east category, or asserts the value and baseline pair for whichever category is hovered (east `15` with `11`, west `7` with `9`);
     - (c) the mutation check covers both a wrong grouped value and the old date-leak path. The assertion must stay red when the card contains `Updated 10/7/2026` but the tooltip shows a wrong value.

### Non-blocking notes

- AC5 (all 4 e2e legs green in CI with the PR head containing current origin/main) has no task. Task 4.1 is local only. This is probably covered by the orchestrator's delivery steps and the driver standing rule in workflow-state.md, but listing it as task 4.2 would make the acceptance signal explicit.
- For hel1350, task 1.3's "unit test that fails before the fix": jsdom does no layout, so a "listbox outside the viewport" defect cannot be shown failing in Jest. If the cause is layout, the before/after red/green proof will have to be the e2e spec itself (run on main = red, on the fix = green) plus a screenshot. The design should not let the executor ship a Jest test that "passes" without exercising layout.
- If the fix scopes the hel1351 assertion away from the card, consider whether any other e2e spec asserts loose digits against a whole `.react-grid-item` text that includes the `Updated` date. Same trap, not in scope to fix, but worth a grep and a follow-up if found.
