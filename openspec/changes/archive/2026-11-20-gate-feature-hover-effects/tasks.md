## Standing Constraints

- [C1] Red first: commit the new guard and its failing run on unchanged CSS (and the touch e2e red run) before editing any stylesheet
- [C2] Touch e2e: only instances shown red on unchanged CSS count as e2e-covered; read computed styles, never `:hover` matching
- [C3] Never edit the e2e specs HEL-1789 is splitting; never edit hel1675-shared-hover or `e2e/support/hel1790Rest.ts`
- [C4] A reveal with no touch path today is escalated per render site, not fixed
- [C5] Every desktop rest/hover read goes through trackPointer/settleToRest/settleToHover from `e2e/support/hel1790Rest.ts` (import only)

### Frontend

- [x] 1.1 Commit the inventory script and its main-tree output (every hover rule, fill/reveal tag, mixed flag) to evidence
- [x] 1.2 Export `PIPELINE_GUARDED_FILES` (paths relative to `frontend/src/`) from `cssHoverGating.ts`; pipeline guard re-relativizes, allowlist byte-identical, still green
- [x] 1.3 Add `frontend/src/featureHoverGating.css.test.ts` (D4); run it on unchanged CSS and COMMIT the red run transcript
- [x] 1.4 Write `e2e/hel1735-feature-hover.spec.ts` (D6 contexts P and T, D5(b) desktop via hel1790Rest helpers); run on unchanged CSS; commit red per instance and the desktop fixture
- [x] 1.5 Probe the reveal's touch path on context T for BOTH render sites (dashboard row, Assistant conversation row) on unchanged CSS; record evidence (escalate per C4)
- [x] 1.6 Gate every in-scope `:hover` rule in place (D1), splitting mixed lists adjacently (D2), leaving the reveal unit byte-identical
- [x] 1.7 Update DESIGN.md §5's hover paragraph (D8); verify prettier check passes

### Tests

- [x] 2.1 Scripted guard mutations: one un-gate per gated file, mixed-list, allowlist-rot, new-file; transcript in evidence
- [x] 2.2 D5(a) structural equivalence script with the stated rule-group normalization; output plus mutations (i)-(iii) each failing, in evidence
- [x] 2.3 Re-run the touch e2e green and the desktop test equal to the 1.4 fixture, light and dark
- [x] 2.4 Re-probe both reveal render sites after 1.6; identical to 1.5
- [x] 2.5 Run every e2e spec found by the D7 grep (plus hel1675-shared-hover and hel1790Rest users) as full files, green
- [x] 2.6 Full jest, lint, typecheck, format check green
