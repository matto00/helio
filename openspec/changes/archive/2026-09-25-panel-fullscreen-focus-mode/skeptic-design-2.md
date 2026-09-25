## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/panel-fullscreen-focus-mode/HEL-584` before any other read.
- **Read all planning artifacts fresh**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/panel-fullscreen/spec.md`, and round 1's `skeptic-design-1.md` in full — treated round 1's findings as claims to re-derive, not facts.

**Round-1 Change Request 1 (design.md — explicit definite-height decision):** Addressed, genuinely.
`design.md` now has **Decision 1a**, naming the specific mechanism (a new `.panel-fullscreen-overlay`
class applied via `Modal`'s `className` prop) and the specific value (`height: min(90vh, 1000px);
overflow: hidden;`), with a stated rationale for the `1000px` (vs. `PanelDetailModal--view`'s `900px`)
deviation. I independently verified the underlying claims this decision rests on, not just its prose:
  - `Modal.css:1-9` — `.ui-modal` still has no `height`, only `max-height: 90vh`; the HEL-746 in-file
    comment (`Modal.css:63-97`) still documents the exact shrink-to-fit failure mode cited.
  - `Modal.css:54-55` — `.ui-modal--full` sets only `width: min(1200px, calc(100vw - 32px))`, no height —
    so the new class is the *only* height rule that will apply; no cascade/specificity conflict (same
    single-class specificity, and `.ui-modal`/`.ui-modal--full` declare no competing `height`).
  - `Modal.tsx:181-186` — `className` is placed directly on the `<dialog className="ui-modal ui-modal--full ...">`
    element itself (`dialogClass = ["ui-modal", "ui-modal--${size}", className]`), the same element
    `.ui-modal`'s `max-height: 90vh` applies to — so `min(90vh, 1000px)` can never exceed that cap (verified
    the two values can't conflict: at ordinary viewport heights `min()` resolves to `90vh`, matching
    `max-height` exactly; only on a very tall screen does `1000px` win, still ≤ `90vh` there).
  - `detailModal/PanelDetailModal.css:8,13` and `PanelDetailModal.tsx:367` — confirmed the cited precedent
    verbatim: `.panel-detail-modal--view { height: min(88vh, 900px); }` applied via the same `className`-on-`<dialog>`
    pattern design.md now mirrors.
  This is the same load-bearing gap round 1 identified, closed with a real, code-grounded, specific
  mechanism — not a reworded restatement of round 1's own language.

**Round-1 Change Request 2 (proposal.md — CSS file in Impact list):** Addressed. `proposal.md`'s Impact
section now lists `PanelFullscreenOverlay.css` explicitly, with the same rule text and rationale as
design.md Decision 1a (lines 37-40) — not just a filename drop-in, the entry actually explains *why* the
file is needed, consistent with the rest of the Impact list's style.

**Round-1 Change Request 3 (tasks.md — height-rule task + 3.1 dependency):** Addressed. New task **1.3**
creates and verifies the `.panel-fullscreen-overlay` rule; task **3.1** is reworded to state its
verification "is only meaningful once task 1.3's definite-height rule is in place and confirmed
(design.md Decision 5); do not assert a resize call against a still content-shrunk container" — a real,
explicit dependency, not a passing mention. design.md's own Decision 5 and the new Risk entry
(lines 100-104) both restate this ordering constraint consistently across design.md ↔ tasks.md.

### Fresh full-artifact re-check (not just the three CRs)

Re-verified round 1's other (non-refuted) findings against current code rather than assuming they still
hold:
- `usePanelData` single-call-site / prop-threading (Decision 2): `PanelCard.tsx:235` is still the sole
  desktop call site; `PanelCardBodyProps extends Omit<PanelDataResult, "isRefreshing">` (`PanelCard.tsx:60`)
  still matches the props shape design.md cites. `MobilePanelStack.tsx` (now under `ui/grid/`, a path
  nesting detail only) still has its own separate call and its own in-file "read-only (no header actions)"
  comment, matching Decision 4's citation.
- `PanelKind` union / eligibility (Decision 3): `panelNarrowing.ts` still defines exactly
  `output | text | markdown | image | divider | form`; `PanelContent.tsx:318-324` still dispatches
  `divider`→`DividerRenderer`, `form`→`FormRenderer`, matching the exclusion rationale.
- `autoResize` (Decision 5): `ChartPanel.tsx:441,453-454` still renders the wrapper and `ReactECharts` at
  `height: "100%"` with `autoResize={true}` — the percentage-height dependency on Decision 1a's definite
  ancestor height still holds as described.
- `spec.md` scenarios: unchanged since round 1, still trace 1:1 to tasks 2.1/2.2/3.1/4.1/4.2.

No new contradiction, placeholder, or scope drift found across any artifact.

### Non-blocking observation on task 1.3's verification method

Task 1.3 asks to "verify the rendered `<dialog>` (or its jsdom-available computed style) actually carries
a definite (non-auto) height." This codebase's Jest config maps `.css` imports to an empty mock
(`jest.config.cjs:8` → `src/test/styleMock.js`, `module.exports = {}`), so a naive
component-render-then-`getComputedStyle` test will **not** see the real `.panel-fullscreen-overlay` rule at
all — it would report whatever jsdom's default is regardless of whether the CSS file was written
correctly, which risks a vacuous pass. Two real precedents already exist in this repo for this exact class
of check: (a) the dominant convention, static source-parsing (`fs.readFileSync` + string/regex match on the
raw CSS, e.g. `detailModal/PanelDetailModal.css.test.ts`, `MobilePanelStack.css.test.ts`); (b) a rarer,
working "inject the real CSS into `document.head` then `getComputedStyle`" pattern
(`OnboardingChecklist.test.tsx`'s file-local `renderWithInjectedCss` helper, not currently a shared util).
Task 1.3 doesn't point the executor at either precedent, and its literal "rendered `<dialog>`" phrasing
leans toward the untested-here, non-shared, more effortful option (b) rather than the simpler, dominant
option (a) that mirrors the very `PanelDetailModal.css.test.ts` file this design explicitly cites as its
model. This is a real risk of executor time lost or of a technically-passing-but-non-diagnostic test, but
it is a test-implementation-strategy nuance an executor can resolve from the codebase's own conventions —
not a decision gap, contradiction, or missing acceptance signal in the design itself. Recording it as a
non-blocking note, not a change request.

### Verdict: CONFIRM

### Non-blocking notes

- Task 1.3's height-verification method should prefer the static-CSS-source-parse convention
  (`*.css.test.ts`, mirroring `PanelDetailModal.css.test.ts`) over a rendered-component `getComputedStyle`
  check, given this repo's CSS-import Jest mock (`styleMock.js`) would make the latter non-diagnostic
  unless the executor also reproduces the `renderWithInjectedCss`-style real-CSS-injection technique.
