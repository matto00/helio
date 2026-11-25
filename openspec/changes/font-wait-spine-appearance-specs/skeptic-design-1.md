## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 793802e50a8de763f905a431ca120490c372404d (the change dir is still untracked). Scope (the four named sites) and the convert-anyway rule are owner rulings. I did not re-open them. I only judged whether the plan will produce honest, sufficient evidence and correct waits.

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/fonts-ready-wait-conversion/HEL-1622`.
- The four sites exist exactly as the ruling cites them:
  - `e2e/hel1579-pipeline-spine-layout.spec.ts:296` and `:465`
  - `e2e/hel1572-appearance-preferences.spec.ts:672` and `:764`
  - hel1572 already imports `waitForWebFonts` (`:15`). hel1579 does not, and D3 adds the import.
- `e2e/support/webFonts.ts`:
  - The scope is `target.closest("tr") ?? target`.
  - The `loadingFaces` check covers the whole page.
  - It is bounded at 10s, and a timeout throws naming the observed state.
  - It calls `target.evaluate`, so every container D3 picks must resolve to exactly one element under Playwright's strict mode. `.spine-header` and the `Run history` Modal look unique. The S3 container is still to be named.
- HEL-1757 (`playwright.config.ts:51-56,218`, `e2e/support/webFontsHost.ts`, `e2e/fixtures/web-fonts/README.md`): both font hosts are mapped with `--host-rules`. The README states that "every page route that `continue()`s a fonts request reaches the server". So `page.route` should still see these requests, because the URL keeps its fonts.* host. D1 makes the executor prove this rather than assume it, which is correct.
- The same README states that a stalled fonts request holds `page.goto` (`load`) open. That fact is what Change Request 1 rests on.
- HEL-1613 method (archive `2026-10-15-adopt-webfonts-wait-layout-specs/evidence/scratch/`):
  - `zzfontgate.ts.txt` holds each family's woff2 responses on a per-family promise and maps URLs to families from the CSS response.
  - Every scratch spec that held fonts changed its `page.goto` to `{ waitUntil: "commit" }`. A grep finds this in about 15 scratch files: `zzd1572-values`, `zzd1572-mixed`, `zzprobe1510*`, `zzprobe813`, `exec4-zzx4-*`, and others.
- Measured families per site:
  - S3 (Mono, `/settings`) calls `findClipped` on `.appearance__type-card-title`. Each type card sets its own `--font-heading` inline (`frontend/src/features/settings/ui/AppearanceSection.tsx:27,63,80`; `AppearanceSection.css:121-123`). So the measured text is in Fraunces (the "Serif headings" card), Schibsted Grotesk (the sans card) and JetBrains Mono.
  - S4 under `serif` puts the Modal title in Fraunces (`theme.css:265`: `--font-heading: var(--font-display)`), and the title is inside the dialog scope D3 picks.
- The `hel1572:126` reference:
  - On the current tree, line 126 falls inside `findClipped` (`:100-135`), which is the helper S3 measures with.
  - At `943b5dd73^` (the commit before HEL-1826, "Deflake ... hel1572:126"), line 126 is the test "re-renders headings with no reload and survives a fresh browser context (another device)". That test is now at `:200`. It has no `fonts.ready` and no geometry, only `fontFamily` reads. HEL-1826 already gave it a probe-confirmed root cause (archive `2026-11-22-deflake-hel1820-e2e-specs`).
- No placeholders, TBDs or scope drift. Every AC maps to a task: AC1 to 2.1, AC2 to 1.1, 1.2 and 2.2, AC3 to 3.2, AC4 to 3.3. No contract or schema delta is needed (test-only).

### Verdict: REFUTE

The plan is close. Four concrete gaps would make the D2/D4 evidence infeasible, partial or misattributed. Each costs one paragraph to fix now and an execution cycle to find later.

### Change Requests

1. **D2/D4 deadlock: held fonts keep `page.goto` from resolving, so the run can never reach the release point.**
   - The problem:
     - D2 installs the hold "before the first `goto`" and releases "after the old `fonts.ready` returns".
     - Every site's test calls a plain `page.goto(...)`, which waits for `load`. Those calls are at hel1579 `:268` and `:461`, and hel1572 `:668` and `:754`.
     - A held font request keeps `load` open (HEL-1757 README). The test therefore stalls in `goto` until the test timeout and never reaches the measurement.
     - The same applies to D4's "never released, must fail at the `waitForWebFonts` 10s bound". With a plain `goto`, it would fail at the `goto` or test timeout instead, so the recorded message would not show what D4 claims.
   - Required revision:
     - Specify the HEL-1613 adaptation: scratch copies use `page.goto(url, { waitUntil: "commit" })`. The existing visibility awaits stay unchanged and still gate the measurement.
     - Record this as the only deviation from the committed test.
     - Apply it identically in the red, green and never-released runs.
     - State that a `goto` or test-timeout failure is neither a red nor a "no red possible" result. It is an invalid run.

2. **Release point per navigation.**
   - The problem: each site navigates more than once.
     - S1: 4 widths, each with its own `goto`.
     - S2: 4 loads (2 list widths x 2 themes).
     - S3: 4 widths.
     - S4: 3 type styles.
   - A one-shot release promise, as in `zzfontgate.ts`, holds only the first navigation. Every later iteration would measure with fonts already released, which proves nothing about that iteration.
   - Required revision: D2 must say one of two things:
     - The hold is re-armed per `goto`, for example a fresh promise per navigation keyed on the document request, and released at that iteration's measurement point.
     - Or exactly which iterations ran held.
   - In either case, record the `document.fonts` state (the gate's `state()` dump) at each held measurement. That makes "the measurement actually ran with the face held" checkable per iteration, not just asserted.

3. **Fraunces is missing from the mixed-state list where the measured text uses it.**
   - The problem:
     - D2 lists only "Schibsted vs JetBrains Mono" mixed states.
     - S3's `findClipped` measures `.appearance__type-card-title`, which is in Fraunces for the serif card, alongside Schibsted and Mono.
     - S4's dialog scope contains a Fraunces title under `serif`.
     - HEL-1613 D5 had the clause "Fraunces joins the mixed-state list only if a measured surface uses it". This design dropped it, and here a measured surface does use it.
   - Required revision:
     - Add Fraunces as a held-alone state for S3. A fixed-width card title rendered in the fallback serif is the most plausible red on that site.
     - For S4/serif, either add it or state why it is not needed (the measured duration is sans, while the title is in scope).
     - Per HEL-1613 D5: because `loadingFaces` is page-wide, holding one family can block a scoped wait for a different family. D4 green runs must read mixed-state results with that in mind.

4. **Pin `hel1572:126` by test title, not line number.**
   - The problem:
     - On the current tree, `:126` lands inside `findClipped`, the S3 measurement helper. An executor reading the number literally would wrongly link the C11 flake to a converted site.
     - The line meant appears to be "re-renders headings with no reload and survives a fresh browser context (another device)": `:126` at `943b5dd73^`, now `:200`. HEL-1826 already root-caused and deflaked it.
   - Required revision: D5 and task 3.3 must:
     - Name the test by title.
     - Cite the commit the line number refers to (resolve it with `git show <commit>:<file>`).
     - Cite the HEL-1826 archive's recorded root cause as the prior explanation the note is checked against.

### Non-blocking notes

- S1 conversion "at the same point" leaves the earlier filter-row width (`:274-279`) and `.spine-header__name` readability (`:280-287`) measurements before any font wait. That is correct under the scope ruling and C15. Mention it in the HEL-1884 handoff so it is not lost.
- Because `readFontState` forces layout and checks `loading` faces across the whole page, a narrow scope rarely lets a page-level swap through. Name the container for each site, but do not spend effort finding the narrowest one.
- For each D3 container, confirm under strict mode that it resolves to exactly one element (`target.evaluate`). This matters especially for the S3 "app shell" (`App.tsx:192` `.app-shell`) and the S2 common ancestor of `.spine-header` and `.spine-body`.
- D5 chunking of hel1579 (the 240s sweep x 20): record the `--grep` partition and confirm each chunk's counts add up to 20 per test.
