## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold spawn. Every claim below is from the files, `node_modules`, and Linear — read myself, not
taken from the orchestrator's account of its own edits.

### What I verified (with evidence)

**Round-3 CR1 (ECharts) — CLOSED, all four clauses.**
`design.md:106-119` D6.1 now names TWO instances of "motion no source text carries" and gives the
ECharts case in full: `animationDuration: 1000` at `echarts/lib/model/globalDefault.js:118`, the
957ms/941ms measurement across 56 canvas repaints, 3.6x `--transition-slow`, `ChartPanel.tsx:452`'s
`notMerge={true}` replaying the entrance, and "no `animation*` option is set anywhere in `src`, so no
CSS guard can see it". It states explicitly that it is NOT re-timed here and is owned by HEL-1034.
`tasks.md:35` (5.4a) is an observe-don't-change task worded as such ("OBSERVE (do not change)"), with
the evidence handed to HEL-1034. I read **HEL-1034 in Linear** myself: Backlog, v0.7 project, created
2026-09-08, and it carries the measurement, the `notMerge` half, clause (d) as a scope item
("Confirm `prefers-reduced-motion` is honoured — the global CSS rule cannot reach a canvas animation
driven by JS") rather than as an asserted finding, and the generalisable lesson. The deferral is
genuinely owned, not narrated.

**Round-3 CR2(a) (staleness arm) — CLOSED, and closed at the point that mattered.**
`design.md:96-100`: the stale arm is now "a STALE exception entry — one matching NOTHING in the tree,
whether a keyframe OR a `transition:` shorthand". `tasks.md:25` (4.2) mirrors it verbatim and adds
the reason: "The stale arm MUST cover shorthands, not just keyframes, or exception (c) survives
forever once HEL-1032 removes PanelGrid's literals." D5 also now states the principle explicitly —
"What makes (c) a principled boundary rather than a hole is precisely that it can EXPIRE." I
re-confirmed the fact the wording turns on: `frontend/src/features/panels/ui/grid/PanelGrid.css:9-14`
is a multi-line `transition:` shorthand (`transform/width/height 180ms ease`), not a keyframe.
**CR2(b) also closed** — `tasks.md:27` (4.3a) requires recording the expected post-change literal
inventory so the exception set is auditable against a stated list.

**Both round-3 non-blocking notes actioned.** `proposal.md:3-5` no longer says the spinners disagree
"in a way a user can see"; it says "they never co-render, so this is scale rot rather than a
side-by-side eyesore". `tasks.md` 3.3 and 5.3 both name **HEL-1032** explicitly.

**Stale-text sweep.** `grep -rniE "two tokens|both directions|folding 180ms into|--app-exit-duration|
the spinoff ticket|a user can see"` across `{proposal,design,tasks,ticket}.md` returns exactly two
hits, both correct rather than stale: `design.md:16` (the two pre-existing shorthand tokens, quoting
DESIGN.md's own nuance) and `design.md:25` (the corrective sentence itself). Risks say "THREE
directions", "adds exactly ONE token", "makes no change to `PanelGrid.css`"; Planner Notes say
"ONE-token outcome". Nothing in the artifacts contradicts the current plan.

**Ground truth re-measured on the branch base (36a9c1cc).** `Spinner.css:11` `ui-spinner-spin 0.7s`,
`PipelineDetailPage.css:996` `pipeline-run-spin 0.8s` / `:979` `pipeline-run-pulse 1.2s`,
`auth.css:38` `auth-card-in 0.45s cubic-bezier(0.3, 0.9, 0.4, 1)`, `PanelGrid.css:9-14` 180ms x3.
`frontend/src/theme/tokenAuditSweep.css.test.ts` exists as the guard-sibling infrastructure the AC
assumes. Everything the plan targets is still exactly where and what it says it is.

### The ruling you asked me to challenge rather than confirm: AC1

I tried to break it and could not. AC1 reads: *"No CSS module declares a literal transition
duration/easing **where a motion token applies**; enforced by a guard test alongside the token-audit
guards."* The question is whether three rounds of narrowing have quietly reshaped the ticket into
its own guard's shape. Testing each surviving literal against that qualifier:

- **Reduced-motion literals** (`theme.css:306/308` `0.01ms`, `BottomNav.css:146+` `transition: none`)
  — mandated by the reduced-motion pattern; no token could express them. Excluded by anyone's reading.
- **Single-use loops** (`streaming-text-blink` 1s, `pipeline-run-pulse` 1.2s) — the ticket's own Scope
  says to add a token "if an easing curve is needed **repeatedly**". A one-consumer value is
  explicitly not what the ticket asks to tokenize. No token applies.
- **`--toast-exit-duration`** — a token *does* apply, and it is applied; it is simply file-scoped, for
  a reason the codebase documented before this ticket existed and a test asserts by name. Not a literal.
- **`PanelGrid.css`'s 180ms** — this is the only load-bearing case, and it is the one where the
  narrowing could have been self-serving. It is not, for three independent reasons I checked myself:
  (i) the ticket's OWN planning audit, written before any skeptic round, already classified it as "a
  THIRD motion category (layout/drag) no token covers" — the exclusion is not something the review
  rounds invented; (ii) the reason it stays is measured and adversarial to the plan's convenience —
  folding to 160ms would widen 180/100/200, which is a reason to do LESS work but also a reason the
  original plan was wrong; (iii) a real ticket owns it (HEL-1032) and the guard exception pinned to it
  can EXPIRE, which is exactly what CR2(a) was for.

That last point is what distinguishes this from a guard drawn around the failures. A guard shaped to
pass is one whose exceptions are permanent and unpinned. Here every exception is pinned to file +
declaration + exact value, a stale entry in any of them goes RED, and the one deferral has a ticket
whose completion mechanically trips the guard. **The ruling still holds: AC1 is honestly met as
written, and no scope restatement is needed.** AC2 is covered by tasks 1.1/5.1 (Popover named,
auth card verified one-animation on the running app in round 2), AC3 is verify-don't-extend bounded to
HEL-538, AC4 is tasks 6.1/6.1a/6.2.

The shipped diff being small is the correct outcome of a measured premise, not evidence of erosion.

### A third frame — I looked, and found nothing new

Rounds 1 and 3 each found motion outside `frontend/src`. I checked the frames you named plus two more:

- **Web Animations API** — `grep -rn "\.animate(\|getAnimations("` across `src`: **zero** hits.
- **SVG SMIL** — `<animate` / `animateTransform`: **zero** hits.
- **`scroll-behavior` / smooth scrolling** — no `scroll-behavior` anywhere; four `scrollIntoView`
  call sites (`OutputPicker.tsx:186`, `CommandPalette.tsx:124`, `ActiveConversationPanel.tsx:99`) and
  **none passes `behavior: "smooth"`** — all are instant `block: nearest`/`end`. This was the most
  plausible remaining JS-driven motion source; it is genuinely absent.
- **View Transitions API** — no `startViewTransition`.
- **Inline TSX motion** — exactly one, `MobileNavSheet.tsx:316 transition: "none"` during drag, no
  duration literal. (The other two `transition:` grep hits are prose in comments.)
- **`index.html`** — no `<style>`, no motion.
- **Non-relative CSS imports** — still exactly two: `react-grid-layout/css/styles.css` (motion, owned
  by HEL-1032) and `react-resizable/css/styles.css` (none). No third stylesheet has entered the tree.

Pseudo-element transitions are inside the CSS audit's window already (the round-1 parse walked all 110
files; `PipelineDetailPage.css:996` is itself a `::before`). The frame is closed as far as I can
reach it.

### Verdict: CONFIRM

All three round-3 items are genuinely closed in the files. No stale text contradicts the plan. AC1's
ruling survives a deliberate attempt to break it. Nothing new in a fourth frame. The plan is sound to
implement.

### Non-blocking notes

1. `design.md:65` still says D3 is "the one place a value visibly speeds up by 38%", which the Risks
   table three paragraphs below corrects on round-2 measurement (front-loaded curve; ~50ms earlier,
   not a perceived 38% jump). Round 3 raised this; still unapplied. Harmless once both are read.
2. Round-3 note 5 / round-2 note 3 remains unapplied: D2's Why does not carry the F-190 framing
   (`PipelineDetailPage`'s `::before` ring is the **last** unconverted copy of the `Spinner` primitive,
   after `PanelContent.css:185`, `auth.css:253`, `MessageComposer.css:4`,
   `ActiveConversationPanel.css:56`). This is the strongest available justification for re-timing a
   shipped duration, and D2 currently ships the weaker half of it. One sentence would close it; the
   decision is right either way.
3. Round-3 note 4 (FontAwesome's injected runtime stylesheet — `.fa-spin`, `@keyframes fa-beat`,
   `--fa-animation-duration`) is not in D6.1's list. It is inert today (zero `fa-spin` usages) and
   ships its own reduced-motion block, so nothing is at risk; one line in D6.1 would just save the
   next motion ticket the rediscovery.
4. Minor tension worth an executor's eye, not a change: `ticket.md:39` says of the three files
   carrying a literal duration that "Two of those three are legitimate", implying `PanelGrid`'s is
   not — while D4-REVISED deliberately preserves it. D4 explains itself with evidence and the ticket
   line is pre-review planning text, so this misleads nobody who reads design.md, but an executor
   reading only ticket.md could infer a fold is expected.
