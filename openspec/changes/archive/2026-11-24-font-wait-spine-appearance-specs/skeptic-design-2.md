## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 793802e50a8de763f905a431ca120490c372404d (change dir untracked). Scope (four named sites) and convert-anyway are owner rulings and were not re-litigated.

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/fonts-ready-wait-conversion/HEL-1622`.
- Sites re-confirmed on the tree: `e2e/hel1579-pipeline-spine-layout.spec.ts:296` (S1, after plain `page.goto` at :268) and `:465` (S2, goto :458, after the max-width `End` keypress); `e2e/hel1572-appearance-preferences.spec.ts:672` (S3, goto :669) and `:764` (S4, goto :759, after the modal-row visibility await). hel1572 imports `waitForWebFonts` at :15; hel1579 does not (D3 adds it).
- `e2e/support/webFonts.ts`: scope `closest("tr") ?? target`, page-wide `loadingFaces`, stylesheet `media === "all"`, 10s bound, loud throw; `target.evaluate` is strict (design Risks names this).
- Round-1 change requests, each traced to the revised text:
  1. Goto deadlock: D2 "Navigation (the one deviation)" mandates `waitUntil: "commit"` in red, green and never-released runs, records it as the only deviation, and classes a goto/test-timeout failure as INVALID. C18 repeats it. Resolved.
  2. Per-navigation hold: D2 "Re-armed per navigation" with per-site navigation counts (S1 4, S2 4, S3 4, S4 3), fallback of naming which iterations ran held, plus a per-iteration `document.fonts` state dump. Resolved.
  3. Fraunces: D2 "States exercised" adds Fraunces held-alone for S3 (`AppearanceSection.tsx` type card title) and S4/serif (dialog title in scope, durations not), and D4 carries the HEL-1613 D5 page-wide `loadingFaces` caveat. Resolved.
  4. hel1572:126: D5 and task 3.3 identify it by title via `git show 943b5dd73^:...` (commit confirmed: "HEL-1826 Deflake hel1791:290, hel1582:244 and hel1572:126"), now at :200, checked against archive `2026-11-22-deflake-hel1820-e2e-specs` (exists). Resolved.
- S3 container feasibility: `frontend/src/app/App.tsx:191-307` — the single `.app-shell` div contains `AppRail`, `CommandBar` (`header.app-command-bar`), the routed `<main>` (Appearance section) and `MobileShell` (which renders `BottomNav`, `nav.bottom-nav`). So one element holds every `findClipped` selector at all four widths, including 375px.
- S2 container: `.spine-header` and `.spine-body` are both measured; D3 requires naming the common ancestor and confirming uniqueness. Feasible.
- HEL-1757 README (`e2e/fixtures/web-fonts/README.md:15-16`): a route that `continue()`s a fonts request reaches the local server, and with no route the HTTP cache is untouched. D1 still requires proving the hold empirically (non-zero held counts, faces held) or BLOCKER. Correct posture.
- Cited archives exist: `2026-10-15-adopt-webfonts-wait-layout-specs/evidence/scratch/` (zzfontgate and the held-font scratch specs), `2026-11-16-metric-matched-fallback-fonts`, `2026-11-18-e2e-local-web-fonts-fixture`.
- AC coverage: AC1 -> 2.1; AC2 -> 1.1, 1.2, 2.2; AC3 -> 3.2; AC4 -> 3.3. No TBDs, no scope drift, no contract delta needed (test-only, `skip_specs: true`). C12 ordering (red evidence committed before conversion) is in task 1.2.

### Verdict: CONFIRM

### Non-blocking notes

- S1 red attribution: under the hold, S1's pre-wait assertions (filter-row widths :276-277, name readability :283-287, chip-in-viewport :291-293) also run in the fallback face, before the converted site. A failure there is NOT a red for S1 (and in a green run it is an out-of-scope failure, not a conversion defect). D2 already requires citing the failing assertion text, which makes this checkable; the executor should state explicitly which assertion failed and treat a pre-:296 failure like an invalid run for the purpose of the S1 verdict.
- S2 release point: each S2 navigation has two measurement phases (the 1280 spine-track check, default only, then the 43-width sweep). Name in the evidence which phase the held measurement covered (e.g. release after the first sweep width), so "this iteration measured held" is unambiguous.
- Re-armed holds on later navigations may be satisfied from a renderer memory cache rather than a new request; D2's "name exactly which iterations ran held" covers this, and the per-iteration state dump is the proof. Do not infer held-ness from the route handler alone.
- Carried from round 1: record the hel1579 `--grep` partition for the 20x runs so each test's count adds to 20; mention the S1 pre-wait measurements in the HEL-1884 handoff.
