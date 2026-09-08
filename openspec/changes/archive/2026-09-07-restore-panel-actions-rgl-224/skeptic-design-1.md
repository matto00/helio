## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All commands run in `.../HEL-1014/frontend` unless noted. Nothing in the worktree was modified;
probes were injected via `npx jest --setupFilesAfterEnv <scratchpad file>` only.

1. **Installed dependency is really 2.2.4.** `node -e require('react-grid-layout/package.json').version` -> `2.2.4`.
   Working tree carries uncommitted mods to `frontend/package.json` (`^2.2.2` -> `^2.2.4`) and `package-lock.json`;
   `main` is at `^2.2.2` / lock 2.2.3. `git diff main...HEAD` is empty (no commits yet).
2. **2.2.4 measurement source, read directly** (`node_modules/react-grid-layout/dist/chunk-BMN6M2VL.js:8-42`):
   `getContentWidth(node)` -> `const computed = Number.parseFloat(style.width); if (Number.isFinite(computed)) return Math.max(0, computed);`
   else `clientWidth - paddingLeft - paddingRight`. `useContainerWidth` uses `Math.round(getContentWidth(node))`.
   No `offsetWidth` read anywhere. Design's description of the API change is accurate.
3. **RED baseline reproduced.** `npx jest --testPathPatterns='app/App.test'` -> `Tests: 2 failed, 27 passed`,
   both at `App.test.tsx:893`. Failure dump shows the phone tree.
4. **Product-side chain confirmed by reading source, not narrative:** `PanelList.tsx:70` uses the real
   `useContainerWidth`; `PanelGrid.tsx:61` `const isPhone = width < panelGridConfig.breakpoints.sm`;
   `MobilePanelStack` renders no `ActionsMenu` (grep for `ActionsMenu|actions` -> zero hits);
   accessible name still produced at `PanelCard.tsx:303` (`label={\`${panel.title} panel actions\`}`).
5. **Explanations 1-3 independently ruled out — the design's ruling is justified, not convenient.**
   Forcing only the measured width to a desktop value (proxying `getComputedStyle().width` -> `"1280px"`,
   product code untouched, `App.test.tsx` untouched) turns the suite fully green:
   `Test Suites: 1 passed, Tests: 29 passed, 29 total`. A name/role/render regression could not be cured by a
   width stub alone. Explanation 4 (harness/width artefact) is correct. This part of the design stands.
6. **D2 IS WRONG — reproduced three times.** Adding exactly the stub tasks 2.1/D2 prescribe
   (`Object.defineProperty(HTMLElement.prototype, "clientWidth", {value: 1280})`, on top of the real
   `jest.setup.ts`) leaves the suite **still RED**: `Tests: 2 failed, 27 passed`. Setup-file application was
   itself verified (a throwing setup file produced its marker twice; an in-setup probe printed
   `{"cw":1280,"ow":1280,...}`, so the stub was live).
7. **Why D2 fails — the recorded root-cause probe measured the wrong node.** The Planning probe
   (`{"computedWidth":"","parsed":null}`) was taken on a bare/detached `div`. The node
   `useContainerWidth` actually observes is `.panel-list__zoom-container` (`PanelList.tsx:376-380`), which
   carries an **inline percentage width** from `zoomContainerStyle` (`PanelList.tsx:181`:
   `width: \`${100 / zoomLevel}%\``). Measured in-harness:
   - bare attached div: `{"attachedWidth":"","parsed":null,"pl":"","cw":1280}`
   - div with `style.width = "100%"`: `{"w":"100%"}` -> `Number.parseFloat("100%") === 100`, **finite**.
   So `getContentWidth` returns **100**, never reaching the `clientWidth` fallback at all. 100 < 768 ->
   phone branch -> no panel-actions button. The measured width is 100, not 0, and no `clientWidth` stub can
   ever change that.

### Verdict: REFUTE

The explanation-4 ruling is sound and well-evidenced. The **fix** is not: the single decision the whole plan
rests on (D2) has been empirically shown not to fix the failure, and the mechanism it is derived from is
inaccurate for the actual measured element. Tasks 2.1, 3.1, 3.4 and the D2 risk analysis all inherit the error.

### Change Requests

1. **Correct the root-cause statement in `design.md` Context, `ticket.md`'s probe transcript, and
   `workflow-state.md`.** Under 2.2.4 the measured width in jsdom is **100, not 0**, and the `clientWidth`
   fallback is **never reached**: the observed node `.panel-list__zoom-container` has inline
   `width: 100%` (`PanelList.tsx:181`, rendered at `:376-380`), and jsdom's `getComputedStyle().width`
   returns the literal `"100%"`, which `Number.parseFloat` turns into a finite `100`. Cite the in-harness
   probe, not a detached-div probe — measuring a bare `div` is precisely what produced the wrong mechanism.

2. **Replace D2.** A `clientWidth` stub is demonstrably insufficient (reproduced RED three times, with the
   stub proven live). The fix must intervene on the value the hook actually consumes —
   `getComputedStyle(node).width` for the grid container. D2 currently rejects that option
   ("far more invasive... would perturb every other consumer of computed style across 263 suites") on
   assertion alone; that rejection is no longer available, so either adopt it with a **measured** blast-radius
   assessment (full-suite run, before/after failure counts pasted) or propose a narrower alternative and
   prove it green on `App.test.tsx` first. Note that a naive global `width: "1280px"` override is broad; a
   narrower shape (e.g. overriding only for the grid container, or returning a px value only where the
   computed width is a percentage) should be evaluated and its choice justified by evidence.

3. **Rewrite task 2.1** so it prescribes the corrected stub, and add an explicit gate to task 2.1/2.2:
   `npx jest --testPathPatterns='app/App.test'` must go from the reproduced 2-failure RED to
   29/29 GREEN with `git diff --exit-code frontend/src/app/App.test.tsx` clean. (I have already shown a
   width-forcing stub achieves 29/29, so this is achievable — but the plan must land on a stub that
   actually does it.)

4. **Task 3.4 is currently theatre and must be restated.** "Remove the `clientWidth` stub, verify the guard
   goes RED" cannot be a real mutation proof: with the corrected fix the `clientWidth` stub is not on the
   consumed path, so removing it may leave the guard green while the guard is still labelled proven. The
   mutation must remove/neuter **the stub the corrected fix actually adds**, and the recorded transcript must
   show the guard red for that specific mutation. Task 3.1's guard (real `useContainerWidth` reports
   >= 768) is a good outcome-shaped guard — keep it, but it must be asserted against the same kind of node
   the product renders (one with an inline percentage width), or it will pass while the app still flips to
   the phone branch.

5. **Name the gate command explicitly in task 3.5.** "Run the full frontend suite" must be
   `npm --prefix frontend test` or `npx jest` **from `frontend/`**, with the pass/fail counts pasted.
   Root `npm test` is `jest --passWithNoTests && npm --prefix frontend test`; the root leg finds zero tests
   and turns silence into a pass. Record the baseline (2690 passed / 263 suites) and the post-fix counts so
   the blast radius of CR2's stub is measured rather than assumed.

6. **`proposal.md` Impact omits `frontend/package.json`.** The working tree already widens the range
   `^2.2.2` -> `^2.2.4`; `^2.2.2` already admits 2.2.4, so this is a deliberate choice that should either be
   listed in Impact and justified (matching Dependabot #481) or reverted to lockfile-only.

### Non-blocking notes

- D5/D6 (real-browser before/after cohesion comparison, no assumed phone actions host) are correctly scoped
  and match the binding run directive; tasks 4.1-4.5 operationalise them adequately. Keep them intact
  through the revision — nothing in CR1-CR6 weakens the need for them.
- D1's refusal to weaken the query, and the decision to leave `App.test.tsx`/`PanelCard`/`ActionsMenu`/
  `PanelGrid` untouched, are correct and independently supported by finding 5 above.
- The 2.2.4 measurement change means any product element the hook observes that carries a **percentage**
  inline width will measure as its numeric percentage in jsdom. Worth a one-line note in the stub comment,
  since it is the non-obvious part a future bump will re-trip over.

---

### Addendum — post-rebase re-verification (D7/D8/D9 added mid-gate)

Re-checked on the rebased base `6b081b86` (HEL-1022, PR #592). Verdict unchanged: **REFUTE**.

- **Finding 6 reproduces on the new base.** With the real `jest.setup.ts` plus the exact D2 stub
  (`clientWidth = 1280`, verified live in-harness), `npx jest --testPathPatterns='app/App.test'` still gives
  `Tests: 2 failed, 27 passed, 29 total`. Same in-harness probe on the new base:
  `{"pct":"100%","cw":1280}` — an element with inline `width: 100%` computes to `"100%"`,
  `Number.parseFloat` -> finite `100`, so the `clientWidth` fallback is never reached. CR1-CR4 stand
  verbatim.
- **The re-derived Planning probe is still measuring the wrong node.** The relayed post-rebase re-derivation
  quotes `{"offsetWidth":1280,"clientWidth":0,"computedWidth":""}` — that is a bare/detached element, not
  `.panel-list__zoom-container`, which is what `useContainerWidth` observes and which carries an inline
  percentage width. The conclusion drawn from it ("width resolves to 0") is false on both bases. Re-derivation
  on a new base does not repair a probe taken against the wrong element.
- **D7 — sound.** Report-don't-fix for HEL-1023/HEL-1006 and the table-panel lane is the right posture and is
  consistent with tasks 4.3/4.4. Nothing in CR1-CR6 invites widening the diff; the corrected fix locus is
  still the test harness only. Add HEL-1023 explicitly to task 4.3's "report any interaction" wording — it is
  currently only in prose in design.md, with no task carrying it.
- **D8 — sound, and its premise checks out.** `git log --oneline -2` confirms HEAD is `6b081b86` and no
  screenshots exist in the change dir, so there is no stale pre-rebase baseline in play. Requiring the
  baseline on this base or later is correct.
- **D9 — sound decision, but NOT implemented by tasks.md.** `frontend/package.json` is currently modified in
  the worktree (`^2.2.2` -> `^2.2.4`) and `grep -n 'package.json\|2.2.2' tasks.md` returns **zero hits**:
  no task reverts it, and task 1.1 still says "Install `react-grid-layout@2.2.4` in `frontend/`", which is
  what produced the artefact. This supersedes CR6 below.

### Change Request 6 (revised, supersedes CR6 above)

6. **Make D9's revert an explicit task.** `frontend/package.json` is dirty in the worktree at `^2.2.4`;
   `tasks.md` mentions neither `package.json` nor `^2.2.2`, so on current tasks the probe artefact ships.
   Add a task: revert `frontend/package.json` to `^2.2.2` and verify `git diff main...HEAD --stat` lists
   `frontend/package-lock.json` and no `frontend/package.json`. Reword task 1.1 so it does not re-introduce
   the range edit (`npm install --package-lock-only react-grid-layout@2.2.4`, or equivalent), and keep its
   `npm ci` resolution check.
