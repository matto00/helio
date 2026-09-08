## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold spawn. Every claim below comes from the files, `node_modules`, or the running app at
5873/8780 — not from the orchestrator's account of its own edits, and not from rounds 1–2.

### What I verified (with evidence)

**Round-2 CR2 (stale text) — CLOSED, and the one residual mention is correct.**
`grep -rniE "two tokens|both directions|folding 180ms into|revert path|two-token|--app-exit-duration"`
across `{proposal,design,tasks,ticket}.md` returns exactly one hit: `design.md:16` "the first two
tokens are transition SHORTHANDS". I read the surrounding paragraph and the category table above it
— that sentence is about `--app-transition` and `--transition-slow`, the two pre-existing shorthands,
and is quoting DESIGN.md's own nuance. **Correct, not stale; I agree it should stay.** The only other
hits are in `workflow-state.md`, which is the run log recording the sweep itself. Risks now say
"THREE directions", "adds exactly ONE token", and D4-REVISED "makes no change to `PanelGrid.css`";
Planner Notes say "the ONE-token outcome". No artifact still asks for `--app-exit-duration`.

**Round-2 CR1 (the guard's day-one RED) — PARTLY applied. Two of its four clauses are missing.**
Applied: `design.md:87-100` D5 now carries exception "(c) — added at design gate r2 CR1 —
`PanelGrid.css`'s three `180ms` transition literals, pinned to those exact declarations and values
and annotated with HEL-1032", and `tasks.md:24` (4.1) mirrors it verbatim including the "WITHOUT (c)
the guard goes RED on day one" warning. `Risks` carries a matching "[The guard goes RED on day one]"
row. Not applied: the stale-entry mutation arm and the expected-inventory clause — see CR2 below.
I re-read `frontend/src/features/panels/ui/grid/PanelGrid.css:9-14` myself: the three `180ms`
declarations are a multi-line `transition:` shorthand, not a keyframe. That distinction is exactly
what the gap turns on.

**D2's corrected rationale — read and judged.** `design.md:49-59` no longer claims user-visible
co-rendering; it states the narrower primitive-vs-local-copy reason and explicitly strikes the old
claim. `proposal.md:16-19` carries the same correction in the What-Changes bullet. (But see
non-blocking note 1: the proposal's *Why* opening still carries the struck claim.)

**Frame check — what NO SOURCE TEXT CARRIES. One genuinely new, measured finding.**

Round 1 found `react-grid-layout`. Round 2 closed inline TSX styles, JS-driven `element.animate`,
rAF choreography and UA defaults. Neither round looked at the **chart library**, which is the app's
most numerous animated surface.

- `frontend/package.json` deps include `echarts ^6.1.0` / `echarts-for-react ^3.0.6`.
- `grep -rn "animation" src --include=*.ts --include=*.tsx` (excluding tests/css) returns **only two
  comment lines in `Toast.tsx`**. Neither `utils/chartAppearance.ts`, `renderers/ChartRenderer.tsx`
  nor `ChartPanel.tsx` sets `animation`, `animationDuration` or `animationEasing`. So every chart
  runs on library defaults, which are, from `frontend/node_modules/echarts/lib/model/globalDefault.js:117-122`:
  `animation: 'auto'`, **`animationDuration: 1000`**, `animationDurationUpdate: 500`,
  `animationEasing: 'cubicInOut'`.
- `ChartPanel.tsx:452` passes **`notMerge={true}`**, so an option change re-inits rather than
  merging — the 1000ms *entrance* replays, not the 500ms update path.
- **Measured on the running app**, dashboard "Revenue by Region" (the only visible chart panel I
  could reach; `/api/dashboards/:id/export` scan found 5 dashboards with a chart panel). I sampled
  `getImageData` hashes of the ECharts canvas every animation frame from mount:

  | run | last canvas repaint after mount | distinct frames |
  | -- | -- | -- |
  | A | **957 ms** | 56 |
  | B (re-run, after switching away to "Helio Roadmap" and back) | **941 ms** | 56 |

  Reproduced, stable, and it matches the library default exactly. **Every chart panel in Helio plays
  a ~1000 ms entrance** — 3.6× `--transition-slow` (0.28s), the token the app uses for every other
  surface entrance, and longer than any value in the plan's five-category table including
  `--app-skeleton-shimmer` (1.6s is a *loop*, not an entrance).
- Reasoned, **not measured**: ECharts renders to `CanvasRenderer` (`echartsCore.ts:20,35` — SVG is
  explicitly never registered), so this animation is a rAF loop painting a raster. `theme.css`'s
  blanket `*, *::before, *::after` `prefers-reduced-motion` rule cannot reach it. I did not have a
  reduced-motion emulation channel in this session, so I am flagging this as an inference to verify,
  not a finding I measured.
- Also new and **inert**: `@fortawesome/react-fontawesome` auto-injects a runtime stylesheet — the
  live page has rules for `.fa-spin`, `.fa-pulse`, `@keyframes fa-beat` and a `--fa-animation-duration`
  token family (109 stylesheets, enumerated via `document.styleSheets`). This is a *third* vendor
  motion source no `frontend/src` text carries. But zero `fa-spin`/`spin=` usages exist in `src`, and
  it ships its own `prefers-reduced-motion` block, so it is dormant and self-consistent. Non-blocking
  note only.
- No SVG SMIL (`<animate`), no `scroll-behavior: smooth`, one inline TSX motion style
  (`MobileNavSheet.tsx:316 transition: "none"`, no literal duration) — consistent with round 2.

### Answers to the questions asked

**1. Is exception (c) a principled boundary or a hole?** Principled *in kind*, but **not yet bounded
in time**, which is what turns a principled exception into a hole. An exception is principled when it
is (i) pinned tightly enough that changing the excepted value still trips the guard, (ii) annotated
with the ticket that removes it, and (iii) **unable to outlive that ticket**. D5 and task 4.1 deliver
(i) and (ii). They do not deliver (iii) — see CR2. Fixed, exception (c) is a self-expiring deferral;
unfixed, it is a permanent licensed hole around the exact literals this ticket exists to remove.

**2. Is AC1 honestly met, or is the guard drawn around the failures?** **AC1 is honestly met as
written, and I do not recommend a scope restatement** — conditional on CR2. AC1 is qualified: "where
a motion token **applies**". No token covers layout/drag motion; the plan deliberately declines to
invent one (D4-REVISED, on evidence that folding would *widen* the 180/100/200 spread), and a real
ticket owns the gap. That is a bounded exclusion, not a guard shaped to pass. The failure mode is not
the exception's existence — it is an exception that cannot expire, which is CR2. I record for the
record what the alternative would have been, so the option is not silently lost: had exception (c)
been unpinnable, the honest restatement would be *"No CSS module declares a literal transition
duration or easing for hover/state-change, entrance, or multi-surface loop motion; layout/drag motion
is out of scope and owned by HEL-1032"* — narrower, and true. I am not asking for it, because the
qualified AC already says this.

**3. Is D2's corrected reason sufficient to justify changing a shipped duration?** **Yes, but it is
the weaker half of the real reason, and the plan should say the stronger one.** "A primitive and a
local copy of it should not disagree" is, on its own, a thin warrant for re-timing shipped motion.
What makes it sufficient is the fact round 2 recorded and this design still does not: F-190 already
converted every other hand-rolled spinner to the `Spinner` primitive (`PanelContent.css:185`,
`auth.css:253`, `MessageComposer.css:4`, `ActiveConversationPanel.css:56` all carry "now the shared
`Spinner` primitive" comments), and `PipelineDetailPage`'s `::before` ring is the **last unconverted
copy**. Aligning its duration is not an aesthetic preference — it is finishing the cheap half of a
migration the codebase already ruled correct, and it makes the eventual markup conversion a no-op
visually. That is a sufficient reason. **I am not recommending D2 be dropped**, and I disagree that
dropping it would be warranted.

**4. Does the ticket have "almost nothing" left?** No — but for a reason the plan currently does not
carry. Its biggest true finding is not the two spinners; it is that the app's most numerous animated
surface enters at ~1000ms while the design system says 280ms, and nothing in `frontend/src` says so.

### Verdict: REFUTE

Two change requests. Neither reshapes the plan; one is an addition, one completes a round-2 CR that
was only partly applied. I have not re-litigated the measured audit, D1's one-token outcome, D3, D7,
D4's reversal, HEL-1032's ownership, or the three-arm mutation requirement.

### Change Requests

1. **The ~1000ms ECharts chart entrance is unexamined and unowned — the plan's own D6.1 case, one
   frame further out than round 1's.** Measured twice on the running app (957ms / 941ms, 56 frames,
   "Revenue by Region"), matching `echarts/lib/model/globalDefault.js:118 animationDuration: 1000`;
   no `animation*` option is set anywhere in `src`, and `ChartPanel.tsx:452 notMerge={true}` makes
   every option change replay the entrance rather than the 500ms update. This is the single largest
   divergence from the motion scale in the app, on its most numerous surface, and it is invisible to
   the guard by construction. **I am NOT asking this ticket to re-time charts** — that is chart feel,
   it is a JS option not a CSS token, and changing it blind is exactly the new-UI/UX-gap risk D4 was
   revised to avoid. Required instead: (a) add the ECharts default table (1000/500/cubicInOut,
   Canvas renderer, `notMerge`) to `design.md` D6.1 alongside the `react-grid-layout` case, since D6.1
   explicitly exists for "motion that no source text carries" and this is its second and larger
   instance; (b) add a task under §5 requiring the executor to **observe a chart panel's entrance on
   the running app** and describe how a 1000ms chart entrance reads next to a 280ms panel/modal
   entrance, as evidence; (c) file a real ticket owning the decision, the way HEL-1032 was filed, and
   name it in the artifacts — a deferral is only real if a ticket owns it, and "note it in the PR
   body" is the failure mode round 2 already called out for `PipelineDetailPage`; (d) record, as a
   question for that ticket rather than a claim, that a Canvas-rendered rAF animation is **not**
   reachable by `theme.css`'s blanket `prefers-reduced-motion` rule — I inferred this from
   `echartsCore.ts:20,35` (CanvasRenderer only) but did not measure it, and the ticket should verify
   before asserting it. This does not touch AC3, which is qualified to "all **touched**"
   animations.

2. **Round-2 CR1 is only partly applied: exception (c) cannot expire, and 4.3 still has no expected
   inventory.** Two clauses of that CR did not land, and both are load-bearing.
   (a) **The stale-entry arm does not cover exception (c).** `design.md:96-97` defines stale as "a
   STALE allowlist entry — one matching no **keyframe** in the tree", and `tasks.md:25` (4.2) repeats
   "a STALE allowlist entry matching no **keyframe** -> RED". But exception (c) is not a keyframe —
   `PanelGrid.css:9-14` is a multi-line `transition:` shorthand. So when HEL-1032 removes those three
   `180ms` declarations, the guard's stale arm will not notice, and the exception survives as a
   permanent hole licensing any future `transition:` literal that happens to land in that file. This
   is the precise defect the stale arm was added to prevent, aimed at the one entry most likely to be
   removed soon. Required: generalise the stale rule in D5 and in 4.2 from "matching no keyframe" to
   **"matching nothing in the tree — keyframe name OR the pinned file+property+value declaration"**,
   and require the third mutation transcript to be taken against exception (c) specifically (delete
   the three `180ms` declarations from `PanelGrid.css`, confirm the guard goes RED on the now-stale
   entry, revert).
   (b) **Task 4.3 still states no expected post-change literal inventory.** As written it asks only
   for a file count and the zero-motion-file behaviour, so "green" is checked against whatever the
   guard happens to accept. Required: 4.3 must state the expected inventory the guard should find
   after the change — `PanelGrid.css` ×3 `180ms`, `streaming-text-blink` 1s, `pipeline-run-pulse`
   1.2s, plus the reduced-motion longhands (`theme.css:306/308` `0.01ms`, `BottomNav.css:146+`
   `transition: none`) — and the run must be compared against that list, not merely be green.

### Non-blocking notes

1. **`proposal.md`'s Why still carries the claim D2 explicitly struck** — and contradicts its own
   bullet fourteen lines below. Line 3: "Motion is the one token family where the app has drifted
   into disagreeing with itself **in a way a user can see**: two spinners…". Round 2 established the
   two spinners never co-render, `design.md:49-51` calls that claim FALSE, and `proposal.md:16-19`
   says "they never co-render, so this is not something a user sees side by side". The Why is the
   sentence a reviewer reads first. Recommend replacing "in a way a user can see" with the corrected
   reason (primitive vs. its last unconverted copy), and folding in the F-190 framing from answer 3
   above.
2. **Tasks 3.3 and 5.3 say "the spinoff ticket" without naming it.** HEL-1032 is filed and is named
   in D4, D5, 4.1 and the Risks table — but 3.3 says "RECORD … for the spinoff ticket … (HEL-1023
   owns that subsystem)" and 5.3 says "as evidence for the spinoff ticket". An executor reading only
   the task list is told an unnamed ticket exists and that HEL-1023 owns it. Name HEL-1032 in both,
   so nobody files a duplicate.
3. **`design.md:65` still says "the one place a value visibly speeds up by 38%"**, which the Risks
   table three paragraphs later corrects on measurement (front-loaded curve; ~50ms earlier, not a 38%
   jump). Harmless once both are read, but D3's own text is the stale half.
4. **FontAwesome injects a runtime motion stylesheet** (`.fa-spin`, `@keyframes fa-beat`,
   `--fa-animation-duration`) that no `frontend/src` text carries — a third vendor motion source
   after `react-grid-layout` and ECharts. It is currently **inert** (zero `fa-spin`/`spin=` usages)
   and ships its own reduced-motion block, so nothing is at risk. Worth one line in D6.1's list so
   the next motion ticket knows the sheet is present the moment someone uses `spin`.
5. Round 2's note 3 (`PipelineDetailPage`'s `::before` spinner is the last unconverted copy of the
   `Spinner` primitive; converting it is a markup change) is still unaddressed in the artifacts and
   is now doing real work — it is the strongest form of D2's justification (answer 3 above). Whether
   or not it becomes a spinoff, it belongs in D2's Why.
