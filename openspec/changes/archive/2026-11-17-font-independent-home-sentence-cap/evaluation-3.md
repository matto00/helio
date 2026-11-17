## Evaluation Report — Cycle 3 (evaluation-3.md)

- **Reviewed HEAD:** `d952614285c9a75b23d8fd3c32ecb0375345450e`.
- **Base:** `6432e69e015fcde437d26262f15601fb59e069af`, resolved live.
- **Working tree:** clean.
- **Frontend source:** `frontend/**` has not changed since cycle 2 (`git diff d9c8f9a3d HEAD -- frontend` is empty), so cycle 2's placeholder sweep still applies to this CSS. That sweep found zero differing widths in both environments, light and dark.

### Evidence I produced myself
Refs are under `/home/matt/Development/helio/.concertino/runs/HEL-1737/evidence/.concertino/scratch/HEL-1737/`.

**Gates**
- lint, format:check, typecheck and build all exit 0.
- `npm test` exits 0 (579 + 9535 tests).
- `openspec validate font-independent-home-sentence-cap --type change` reports the change as valid.

**e2e for hel1665 + hel1678 at this head**

| Run | Result | Ref |
|--|--|--|
| CI-like browser (noble 1.55.1 + fonts-dejavu, Liberation kept) | **94 passed** | `eval3-e2e-ci.txt` |
| Host | **94 passed** | `eval3-e2e-host.txt` |
| DejaVu-only browser: band, 1440, data-before-font, measure, Serif and Mono cases | **44 passed** | `eval3-e2e-dv.txt` |
| Host, the single-read measure test with `--repeat-each=8` (48 runs) | **48 passed**. All 16 Serif reads were `640.001/640` | `eval3-e2e-measure-rep.txt` |

**Linear**
- HEL-1748 exists: "Home opening sentence: 30px reflow at 605-613px when data arrives before the web font". Backlog, Low, relatedTo HEL-1737.
- HEL-1749 exists: "Home opening placeholder: one skeleton bar per line at 431-604px". Backlog, Low.

### Phase 1: Spec Review — PASS
- **Cycle-2 CR3 is resolved.** The four places named in CR3 now state the residual consistently: accepted by the owner (ruling accept-residual-with-followup) and tracked by HEL-1748.
  - design.md "Open residual (accepted by the owner; follow-up HEL-1748)", plus the committed "Owner ruling 2" paragraph.
  - spec.md "Known accepted residual (not a requirement)".
  - tasks.md 2.3.
  - measurements.md "Cycle 2".
- The ruling matches events.jsonl line 37 (human answer).
- **Placeholder polish:** tasks 5.1 records it as deferred to HEL-1749.
- **Cycle-2 CR2 is resolved.** The unsupported base-flake claim is withdrawn with an explicit correction note in measurements.md.
- **Acceptance criteria, as ruled by the owner:** all met.
  - The cold-load swap is 0px at 605-613px and at desktop widths, light and dark, under both fallback environments.
  - When data arrives before the web font, the swap is 0px at 1024, 1280 and 1440.
  - The 0px series and the HEL-1678 ≤4px assertions are green.
  - The new checks were red on base (cycle-1 evidence).
- **Constraint C1:** honoured.

### Phase 2: Code Review — PASS
- **Cycle-2 CR1 is resolved.** In `e2e/hel1665-home-phone-stability.spec.ts`, the retry poll is gone. The test now makes a single `measure()` read, after two real settle waits:
  - the CDP rendered-face precondition;
  - `document.fonts.status === "loaded"`.
  The 48 repeated runs on the host were all green.
- The theme.css tokens, the HomePage.css guard against `data-type-style`, and the font-hold/CDP helpers are unchanged from cycle 2 and sound.

### Phase 3: UI Review — PASS
- The UI CSS has not changed since cycle 2.
- Every Home stability, band, desktop, Serif/Mono and large-font case passes in three font environments.
- The settled rendering is unchanged from base, according to the executor's pixel diff.
- Visual cohesion is left to the skeptic.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `e2e/hel1665-home-phone-stability.spec.ts`: `const measure = () => page.evaluate(...)` is now called once. It could be inlined as `const m = await page.evaluate(...)`.
- PR body: name HEL-1748, the accepted 605-613px data-first residual, and HEL-1749, the deferred skeleton polish.
