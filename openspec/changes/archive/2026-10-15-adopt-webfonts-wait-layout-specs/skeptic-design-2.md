## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 67c434c6b01f9b91681870488975be5ca370c896. The change dir is untracked (`git status --short`: `?? openspec/changes/adopt-webfonts-wait-layout-specs/`).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/adopt-webfonts-wait-layout-specs/hel-1613`.
- **Round-1 CR1 (wait once per navigation): genuinely addressed, not just reworded.** D4 now requires a wait before EACH measurement step whose measured element contains newly rendered text. The wait is scoped to the narrowest measured container, runs after any animation settle, and never runs inside an assertion retry or poll. D4 names hel813 surface 7's three steps and the JetBrains Mono cells. It also commits to updating the helper's "once per navigation" comment. D5 now requires red/green "covering EVERY step that gets a wait". Tasks C4 and 2.2 carry this through. I checked it against the tree:
  - `e2e/hel813-mobile-touch-target-floor.spec.ts:298-345` really does sweep the CTA, then the dialog after `waitForTimeout(400)`, then the list row, all in one navigation.
  - `ConnectorsPage.css:110-111` and `:230-231` set `font-family: var(--font-mono)`.
  - `e2e/support/webFonts.ts:26` still has the "once per navigation" comment that D4 commits to fixing.
- **Round-1 CR2 (non-deterministic mid-swap): addressed.** D1 now specifies held font responses: a `page.route` handler awaits a promise that the spec releases at named points. For hel1510 the point is after the card limit is computed and before the controls loop. For hel813 it is between each pair of measurement steps. D1 also requires fallback-only and per-family mixed states, or else an exact statement of which states were exercised. REFUTED requires the assertion to hold in fallback-only AND mid-measurement-release states. Task C5 mirrors this.
- **D4's backward compatibility holds.** `readFontState` gates on `row !== null` (webFonts.ts `settled`). Its only caller chain is `settledRowTop` (`rowDeleteGesture.ts:26`), which is used by hel1605 and the rowDeleteGesture helpers. Each passes a button inside a `<tr>`, so `closest("tr") ?? target` leaves them unchanged. Task 2.1 re-runs them.
- **The fonts cited in the design exist.** `frontend/app.html` loads Fraunces, Schibsted Grotesk and JetBrains Mono from `fonts.googleapis.com` with `media="print"`, swapped on load.
- **AC coverage:**
  - AC1: D1 and task 1.1.
  - AC2: D2 and task 1.2, with the widened pattern from round 1's note: `toBeInViewport|scrollHeight|clientHeight|offsetHeight|elementFromPoint|getClientRects`.
  - AC3: D3, D5 and tasks 1.3, 2.2 and 2.3.
  - AC4: C1.
  - AC5: D6 and task 3.1, with `--workers=2` and `nice -n 19`.
- **Scope:** test-only, no API or schema change, so `skip_specs` is correct.
- **Placeholders:** none. The artifacts contain no TODO or TBD and no deferred decisions.

### Verdict: CONFIRM

### Non-blocking notes

- **The green half of D5 can deadlock under the held-response mechanism. The executor must decouple the release from the spec's step order.** D5 says to run "the same forced-delay run with the conversion". If the release is a statement placed after the measurement point, a converted spec's `waitForWebFonts` (inserted before that point) polls for 10 s and then throws. That is loud, not silent, but it is red for the wrong reason. For the green run, release the held fonts concurrently, for example on a timer that fires while the wait is polling, so the wait is shown actually blocking until the swap. The released-up-front variant only shows the fonts were already present.
- **Leftover wording in D1.** The first sentence still says "with the delay tuned so the swap lands inside the measurement window", and the next sentence says the delay is NOT a tuned timer. The held-response text is the operative one. Read it that way.
- **Mixed states should include Fraunces where relevant.** D1 names Schibsted Grotesk and JetBrains Mono, but `app.html` also loads Fraunces. If a swept surface measures a Fraunces heading, include it in the per-family states, or say it was not exercised.
- **Scope of the global gate.** The generalised helper's `settled` still requires `loadingFaces.length === 0` across the whole document, not just within the scope. That is fine, and it is conservative. Under a per-family hold, though, a scoped wait will also block on a held face the scope does not use, once that face has started loading. Keep this in mind when reading mixed-state probe results.
