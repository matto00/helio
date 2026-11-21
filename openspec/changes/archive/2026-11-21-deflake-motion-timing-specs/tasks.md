## 1. Probe and root cause

- [x] 1.1 Pull CI logs/traces for jobs 136762650040 and 136692847230 (+ runner CPU model); save to the main checkout's .concertino/scratch/HEL-1814/
- [x] 1.2 Reproduce failure A (segmented indicator, Full) locally, with CPU throttling if needed; instrument data-indicator at click and transitionrun vs live CSSTransition
- [x] 1.3 Reproduce failure B (chart later-span) locally, with CPU throttling if needed; instrument span frame counts and sources
- [x] 1.4 Write root-cause.md per failure (probe evidence, confirmed hypothesis) to the change dir; commit red runs as .txt

### Tests

- [x] 2.1 Fix failure A in e2e/support/hel1573-motion-primitives.ts (and motionRecorder.ts if H-A2) per design Decision 2
- [x] 2.2 Fix failure B in e2e/hel1573-motion-grid-chart.spec.ts per design Decision 3 (entrance keeps a lower bound; later = labelled guard)
- [x] 2.3 Mutation A (motion.css indicator transition removed): Full test red AT the indicator transition assertion; commit .txt; revert
- [x] 2.4 Mutation B (chartAppearance library defaults): chart test red AT the rewritten entrance assertion; commit .txt; revert
- [x] 2.5 20x in a row per spec file (2 workers, nice -n 19), plus a throttled run; commit outputs .txt
- [x] 2.6 Run every hel1573-motion-primitives-*.spec.ts part (full, subtle, off, os-reduce) and every other motionRecorder.ts importer once
- [x] 2.7 lint + typecheck + prettier on changed files
