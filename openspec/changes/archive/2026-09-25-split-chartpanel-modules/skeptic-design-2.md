## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` returned
  `READY ambient=/home/matt/Development/helio branch=task/split-chartpanel-modules/HEL-1180` —
  proceeded normally.
- **Read all planning artifacts fresh**: `ticket.md`, `proposal.md`,
  `design.md`, `tasks.md`, and round 1's `skeptic-design-1.md` (as a claim to
  verify, not as fact) — all in full.

- **Revision 1 (`baseAppearance`/`baseChartConfig` omission) — verified closed
  against ground truth, not just against round 1's own claim:**
  - `sed -n '190,215p' ChartPanel.test.tsx` confirms the two constants are
    declared at lines 198-212, exactly as design.md D6 / tasks.md 4.2 (revised)
    now state.
  - `grep -n "baseAppearance\|baseChartConfig" ChartPanel.test.tsx` → 32 usage
    sites. I independently mapped every one of the 32 line numbers against the
    file's 14 top-level `describe(` block boundaries
    (`grep -n "^describe("`) and against tasks.md 4.3's five-way destination
    split:
    - Lines 158/175/510/511/553/619/644 → inside "appearance" (108-213) /
      "chartOptions (HEL-248)" (508-688) → `ChartPanel.appearance.test.tsx`.
    - Lines 223/224/483/484/695/696 → inside "pie chart" (214-262) /
      "scatter chart" (474-508) / "F-027 regression" (688-744) → retained
      `ChartPanel.test.tsx`.
    - Lines 267/268/299/300/330/331/368/369 → inside "chartAggregate
      (HEL-292)" (262-365) / "pie chartAggregate (HEL-624)" (365-418) →
      `ChartPanel.aggregate.test.tsx`.
    - Lines 424/436/465/776/802/845 → inside "compact (HEL-301)" (418-474) /
      "compact grid sizing (F-028)" (744-818) / "measured compact
      (F-094/F-026)" (818-926) → `ChartPanel.compact.test.tsx`.
    - Lines 928/940/969 → inside "tooltip and hover emphasis (HEL-566)"
      (926-end) → `ChartPanel.theme.test.tsx`.
    All 32 usages land inside the destination file design.md/tasks.md
    already assign them to — the revision is exhaustive and correctly
    scoped, not just superficially present.
  - Noted (does not affect the verdict): two of these usages (lines 158, 175,
    inside the "appearance" `describe` block) textually precede the `const
    baseChartConfig = {...}` declaration at line 204. This works today only
    because `it(...)` callbacks execute after the whole module finishes
    evaluating (JS hoisting + TDZ resolves before the deferred callback
    runs). Once split, these become ordinary top-of-file `import`s in
    `ChartPanel.appearance.test.tsx`, which is strictly safer than the
    current in-file ordering — not a new risk introduced by the revision.

- **Revision 2 (`buildChartOption` signature) — verified closed against
  ground truth:**
  - `grep -n "void theme\|void accentColor\|void themeSyncTick"
    ChartPanel.tsx` → lines 363-365, inside the current `useMemo` callback
    (352-537), immediately followed by `const themeTokens =
    resolveChartTheme();` — exactly the structure design.md D2 (revised) and
    tasks.md 2.1 now specify moving into `useChartOption.ts`'s own `useMemo`.
  - `sed -n '520-537p'` confirms `theme`/`accentColor`/`themeSyncTick` appear
    ONLY in the `useMemo`'s own dependency array (the hook-level concern D3
    correctly keeps in `useChartOption.ts`) and nowhere else in the
    353-537 body — confirming `buildChartOption`'s extracted body never
    actually needs these three as arguments, only `themeTokens`.
  - `cat eslint.config.cjs` (repo root, not `frontend/`) confirms `files:
    ["**/*.{ts,tsx}"]` spreads in `tseslint.configs.recommended.rules`
    with no `argsIgnorePattern` override anywhere in the file — the lint-risk
    reasoning behind the original D2 draft (now removed) was real, and the
    revised design's approach of never adding the three as parameters at all
    sidesteps it correctly regardless of the rule's exact default.
  - The revision is internally consistent with D3 (hook owns the dependency
    array copied verbatim) and D5 (component-level concerns stay put) — no
    new contradiction introduced.

- **Full pass over the rest of the artifacts for new issues**: no `TODO`/
  `TBD`/`FIXME`/"figure out later" anywhere in `design.md`/`tasks.md`/
  `proposal.md` (`grep` returned no hits). Ticket ACs (behavior-preserving
  split, lint/typecheck/test gates, red-first mutation proof, live Playwright
  verification without remount) all still map to concrete tasks (5.1-5.3).
  `workflow-state.md` confirms this is round 2 of design gate
  (`SKEPTIC_CYCLE: 1`, prior verdict `REFUTE`) — consistent with the prompt.
  No sign the revision introduced scope drift, an internal contradiction
  between design.md and tasks.md, or a new ambiguity anywhere else in the
  two files (D1/D3/D4/D5/D6-mock-hoisting/Risks/Migration Plan/Planner Notes
  sections are textually unchanged from round 1's already-confirmed reading).

### Verdict: CONFIRM

Both round-1 Change Requests are closed, and closed correctly — not by
re-wording to satisfy a string match, but by a design change that is
grounded in and verified against the actual file contents (`ChartPanel.tsx`,
`ChartPanel.test.tsx`, `eslint.config.cjs`). No new gaps found in a fresh
full pass over `ticket.md`/`proposal.md`/`design.md`/`tasks.md`. The plan is
sound enough to implement.

### Non-blocking notes

- None beyond what round 1 already noted (already addressed): D2's revised
  text now explicitly states `resolveChartTheme()`'s call-site position
  relative to `buildChartOption(...)`, closing round 1's non-blocking
  observation as well, though that was never a blocking item.
