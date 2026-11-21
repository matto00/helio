## Standing Constraints

- [C1] Never read/cat/grep/source/print or copy any .env file; no env-dumping commands (scripts/concertino/.concertino.env may be read by scripts, never printed).
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs; stop servers with scripts/concertino/stop-servers.sh; test residue deleted by exact id.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; no background run past the tool timeout.
- [C12] Red first: commit the failing e2e run (spec + recorded output) BEFORE any implementation CSS; mutation-check the fix.
- [C13] Scratch in .concertino/scratch/HEL-1791/; durable artefacts in .concertino/runs/HEL-1791/evidence/.
- [C14] Lane DB helio_hel1791: DATABASE_URL for start-servers.sh, Playwright and every e2e cleanup step; backend with ANTHROPIC_API_KEY exported empty.

### Frontend

- [x] 1.1 Probe the live collapse per design.md Decision 1 at 390/768/1100 (sidebar open); record the ancestor table and the style-override confirmation in evidence (no file edits yet).
- [x] 1.2 After the red commit (2.1-2.3), add `.mobile-panel-stack__item.mobile-panel-stack__item--form` to the intrinsic-height rule in MobilePanelStack.css.
- [x] 1.3 Add the `.mobile-panel-stack__item--form .panel-content--form` intrinsic override (height auto, no inner vertical scroll).
- [x] 1.4 Touch CounterControl.css / shared Crossfade/PanelContent rules only if the probe shows 1.2-1.3 insufficient; scope any such rule under `--form`.

### Tests

- [x] 2.1 Write e2e/hel1791-compact-counter-stack-height.spec.ts: owner + editor, 390/768/1100 sidebar open, light + dark; value, +, -, caption (editor) inside card rect; no inner scroll.
- [x] 2.2 In the same spec, a per-kind height table (output, text, markdown, image, divider, multi-field form, compact counter) at the three widths, written to evidence.
- [x] 2.3 Run 2.1-2.2 on the unfixed tree; commit the spec plus the recorded red output (evidence) before 1.2.
- [x] 2.4 Re-run green after 1.2-1.3; compare per-kind heights to the red run (non-form kinds equal within 1 px); record.
- [x] 2.5 Mutation: drop the `--form` selector, confirm the spec goes red, restore; record.
- [x] 2.6 Add/extend a MobilePanelStack.css.test.ts assertion that `--form` is in the intrinsic-height rule.
- [x] 2.7 Run lint, typecheck, format:check and the affected jest files; run the full new spec file plus hel1088-compact-counter-chrome.spec.ts.
