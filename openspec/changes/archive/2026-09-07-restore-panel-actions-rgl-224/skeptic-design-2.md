## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Fresh cold spawn. All commands run in
`.../HEL-1014/frontend` unless noted. Nothing in the worktree was modified; the shim was injected via
`--setupFilesAfterEnv` only.

### What I verified (with evidence)

1. **Base and dirty state as briefed.** `git log --oneline -3` -> HEAD `6b081b86`. `git status --short` ->
   ` M frontend/package.json`, ` M frontend/package-lock.json`, `?? openspec/changes/...`. No commits yet.
   `grep '"version"' node_modules/react-grid-layout/package.json` -> `2.2.4`.

2. **CR2 — blast radius reproduced INDEPENDENTLY, both numbers exact.**
   - Baseline, no shim, `npx jest` from `frontend/`:
     `Test Suites: 1 failed, 271 passed, 272 total` / `Tests: 2 failed, 2766 passed, 2768 total`,
     both failures at `App.test.tsx:893`.
   - With the scratchpad shim, `npx jest --setupFilesAfterEnv ./src/test/jest.setup.ts --setupFilesAfterEnv <shim>`:
     `Test Suites: 272 passed, 272 total` / `Tests: 2768 passed, 2768 total`.
   The design's recorded figures are not re-asserted narrative — they are measured and they match mine digit for digit.
   Exactly the two target assertions flip; zero collateral across 272 suites. **D2 is sound.**

3. **CR2 — I attacked the "already px passes through" carve-out and could not break it.** The carve-out only ever
   *widens* what jsdom leaves unresolved: `""` (no width set) and `"100%"` get proxied to `1280px`; an explicit
   `500px` is returned untouched. The failure mode it could have (a test asserting a computed width of `""`/`auto`,
   or setting a percentage width and asserting on it) is exactly what the 272-suite green measures away. The proxy
   shape itself is correct where it matters: `Reflect.get(target, prop, target)` preserves `this` for
   `CSSStyleDeclaration`'s accessor properties, methods are bound, the prototype is preserved so `instanceof` and
   `jest-dom`'s `toBeVisible`/`toHaveStyle` still see a real declaration. No consumer-breaking hole found.

4. **CR1 — corrected mechanism present in `ticket.md` and `design.md`, MISSING from `workflow-state.md`.**
   `ticket.md:52-63` carries an explicit "CORRECTED MECHANISM" block (100, not 0; fallback never reached; the
   used-vs-specified-value asymmetry). `design.md:20-26` states the same. But
   `grep -n 'clientWidth' workflow-state.md` shows the disproven claim survives verbatim in two places —
   `workflow-state.md:32-34` ("the measured width is 0 in jsdom (probe:
   `{"offsetWidth":1280,"clientWidth":0,"computedWidth":"","parsed":null,"finite":false}`)") and `:78` (the rebase
   re-derivation repeating the same bare-div probe). See CR1.

5. **CR3 — tasks 2.1-2.3 prescribe the corrected stub with a real RED->GREEN gate.** 1.2 pins the RED
   (`npx jest --testPathPatterns='app/App.test'` -> 2 failed / 27 passed at `:893`, counts pasted); 2.1 prescribes
   the shim in the D2 shape; 2.3 requires `Tests: 29 passed, 29 total` **with
   `git diff --exit-code frontend/src/app/App.test.tsx` clean** — the fixture-untouched condition is explicit. Sound.

6. **CR4 — 3.4 is now a real mutation and 3.1 measures the right node shape.** 3.4 names the shim the fix actually
   adds and explicitly excludes the withdrawn `clientWidth` stub as off-path. 3.1 requires the guard be asserted
   against "a node carrying an INLINE PERCENTAGE WIDTH ... a bare `div` would pass vacuously". Both are genuinely
   failable: without the shim such a node measures 100 (< 768); with it, 1280. Correctly labelled guards, with 3.3
   giving the accessible-name guard its own independent label-removal mutation. Sound.

7. **CR5 — gate command named and the root trap avoided.** 3.5 says `npx jest` from `frontend/` and calls out that
   root `npm test`'s `jest --passWithNoTests` leg turns worktree-root silence into a pass. 1.3 records the baseline;
   3.5 requires the post-fix counts pasted against it. The expected counts in 1.3/3.5 match my measurements. Sound.

8. **CR6/D9 — handled honestly, with one gap.** Task 1.1 explicitly orders the `^2.2.4` -> `^2.2.2` revert and
   `proposal.md` Impact now names `frontend/package.json` and says the probe widened it. But the revert is
   incomplete as specified: `git diff package-lock.json` shows the lockfile ALSO carries `"react-grid-layout":
   "^2.2.4"` in its root `packages[""]` dependency map, and 1.1's stated check (`git diff frontend/package.json`
   showing no change) does not see it. I checked whether `npm ci` would catch it — it does not: with
   `package.json` reverted to `^2.2.2` and the probe lockfile, `npm ci --dry-run` **succeeds** (`added 1013
   packages`), because 2.2.4 satisfies `^2.2.2`. So the mismatched range would ship silently. See CR3.

9. **Stale artefact in `design.md`'s Risks section.** `design.md:119` still reads
   "[Stubbing `clientWidth` globally perturbs unrelated suites]" — a risk for the D2 that was withdrawn at `:58-60`.
   The document now contradicts itself about what the fix is. See CR2.

10. **D5/D6 and tasks 4.1-4.5 survived the revision intact.** Diffed against round 1's description: D5 still
    requires real-browser 2.2.3-vs-2.2.4 desktop comparison (position, size, hover/focus, stacking against the drag
    handle, drag+resize, both themes) and still states that a green jsdom accessible-name assertion is not evidence
    of any of it; D6 still forbids assuming a phone actions host. 4.1/4.2 (before+after, light+dark, on the rebased
    base per D8), 4.4 (phone), 4.5 (record + escalate with screenshots rather than judge) are unchanged. Nothing was
    weakened to accommodate the D2 rewrite.

11. **D7's HEL-1023 obligation is now carried by a task (round 1's closing note).** Task 4.3 ends
    "if 2.2.4 alters overlap behaviour at mismatched breakpoints, REPORT it as an HEL-1023 interaction and DO NOT fix
    it here (D7)". 4.4 does the same for HEL-1006. Both are real, filed tickets, so the deferrals are real.

### Verdict: REFUTE

The central round-1 finding is properly accepted and the replacement decision is the strongest part of this revision:
D2 is now measured rather than argued, and I reproduced both of its numbers exactly without relying on the
orchestrator's account. CR2, CR3, CR4, CR5 and the D7 closing note are genuinely addressed. What blocks is narrow and
cheap: CR1 was only two-thirds done — the document the executor is actually briefed from still asserts the disproven
mechanism, and it is the one place a stale root cause can silently steer implementation back to the withdrawn stub.

### Change Requests

1. **Finish CR1 in `workflow-state.md`.** Replace the "## Root cause (probe-confirmed during Planning)" block
   (`workflow-state.md:32-34`) and the stale probe quote in "## REBASE RE-DERIVATION" (`:78`) with the corrected
   mechanism already written in `ticket.md:52-63`: the observed node is `.panel-list__zoom-container`
   (`PanelList.tsx:376-380`) carrying inline `width: ${100/zoomLevel}%` (`PanelList.tsx:181`); jsdom's
   `getComputedStyle().width` returns the literal `"100%"`; `Number.parseFloat("100%") === 100` is finite; so
   `getContentWidth` returns **100** at its first branch and the `clientWidth` fallback is **never reached**. Delete
   the `{"clientWidth":0,"computedWidth":"","parsed":null,"finite":false}` bare-div probe transcript from both
   places rather than leaving it alongside the correction — it is the wrong-node measurement, not corroboration.

2. **Retire the stale risk bullet at `design.md:119`.** "[Stubbing `clientWidth` globally perturbs unrelated
   suites]" belongs to the withdrawn D2 and contradicts `design.md:58-60`. Replace it with the risk the shipped D2
   actually carries — a test that deliberately sets a percentage or unset width and asserts on the computed value
   would now read `1280px` — and cite the measured evidence that no such test exists today (272/272 suites green
   with the shim, 271/272 without).

3. **Make task 1.1's revert cover the lockfile's declared range, and fix its verification.** The probe install wrote
   `"react-grid-layout": "^2.2.4"` into `frontend/package-lock.json`'s root `packages[""]` dependency map as well as
   into `package.json`. 1.1's check (`git diff frontend/package.json` shows no change) does not see it, and I
   verified `npm ci` does not catch it either — with `package.json` at `^2.2.2` and the probe lockfile,
   `npm ci --dry-run` succeeds, because 2.2.4 satisfies `^2.2.2`. Restore that lockfile line to `^2.2.2` so the only
   lock change is the `node_modules/react-grid-layout` version/resolved/integrity triple, matching the lockfile-only
   shape of Dependabot #481 that D9 is aiming at. Verify with the check round 1 asked for:
   `git diff main...HEAD --stat` lists `frontend/package-lock.json` and no `frontend/package.json`, plus
   `git diff main -- frontend/package-lock.json` showing no `^2.2.4` in the added lines.

### Non-blocking notes

- The shim captures `globalThis.getComputedStyle` at setup-file load. Any test that later does
  `jest.spyOn(window, "getComputedStyle")` will replace the shim wholesale for that file and re-expose the phone
  branch. Nothing does today; worth one line in the 2.2 comment so the next author sees the interaction rather than
  rediscovering it as a mystery failure.
- The shim also applies to pseudo-element queries (`getComputedStyle(el, "::before").width` -> `1280px`). Harmless
  today, measured harmless across 272 suites, but not something the "emulating the used value" rationale in D2
  actually justifies. A narrower `if (pseudoElt) return style;` early-out would cost nothing.
- Task 1.1's first clause ("Ensure `frontend/package-lock.json` records 2.2.4") names no command. Given CR3, spelling
  out the exact procedure would remove the risk of the executor re-running a plain `npm install react-grid-layout@2.2.4`,
  which is precisely what produced the artefact being reverted.
- Task 3.4 mutates the shim, which IS the fix — so 3.1 is strictly a "fix is present and effective" guard rather than
  an independent behavioural one. That is the right guard for this defect class and is labelled as a guard, so it is
  not an objection; just be explicit about it in the recorded transcript so a later reader does not over-read it.
