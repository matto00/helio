## Lane Constraints (driver, bind every role)

- C1 never read/cat/grep/source/print any .env file; no env-dumping commands; only scripts may read scripts/concertino/.concertino.env, never print it; never copy .env files.
- C2 quoted heredocs only (<<'EOF').
- C3 no pkill/pgrep/killall; exact PIDs; stop servers with stop-servers.sh; delete residue by exact id (buildUserDeleteSql); plain emails.
- C4 jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- C5 Bash timeout 600000; no background run past the tool timeout.
- C11 known flakes: hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184, hel1665-home-phone-stability:437, hel1573-motion-grid-chart:104; candidates hel1656-pull-to-refresh:340, hel1573-motion-primitives:272, hel1684-draft-structural:427, hel1668-schema-panel-copy:112 (match on test title).
- C12 red first with mutations; full spec files; commit the red run before implementation code.
- C13 scratch in .concertino/scratch/HEL-1774/; follow-up-relevant evidence in .concertino/runs/HEL-1774/evidence/.
- C14 lane-private DB helio_hel1774 (DATABASE_URL for start-servers.sh AND Playwright); start backend with ANTHROPIC_API_KEY exported empty; drop the DB at Delivery.

## Standing Constraints

- [C15] The injected hidden-element e2e case is built on a modal body whose content overflows (span as last child, body scrolled to top) and must be red in the committed red run; a case green in the red run is labelled a guard, never a discriminator.

## 1. Inventory

- [x] 1.1 List every `<Modal>`/`BottomSheet` consumer and non-Modal sheet/drawer scroll container; verify the list against `grep -rln "<Modal\b\|<BottomSheet\b" frontend/src`.
- [x] 1.2 Live-probe each reachable one at 375x812 and 1280x800 (dialog/body scrollHeight vs content bottom; every absolute/fixed descendant of the body with its containing block and hidden/visible); verify by writing `.concertino/runs/HEL-1774/evidence/inventory.md`.
- [x] 1.3 For unreachable modals, list the reason and the statically found absolute descendants; verify each appears in inventory.md.

### Tests (red first)

- [x] 2.1 Write `e2e/hel1774-modal-scroll-extent.spec.ts` (Decision 4) and run it red on unfixed CSS; verify the red transcript is saved to evidence and committed before any fix.

### Frontend

- [x] 3.1 Apply the fix chosen per design Decision 2 (shared `.ui-modal__body { position: relative }` unless the inventory forces the fallback), with a comment citing HEL-1774; verify `npm run lint` and Prettier pass.
- [x] 3.2 Record per-child before/after rects for every absolute descendant the rule moves and every popover kind opened from a modal; verify by a "Moved children" table in inventory.md and a Resolution section in design.md.
- [x] 3.3 Update the HEL-1763 group comment to point at the shared rule; verify OutputEditorSheet.css diff is comment-only.

### Tests

- [x] 4.1 Extend `frontend/src/shared/ui/Modal.css.test.ts` with the static `.ui-modal__body` position guard; verify `npm --prefix frontend test -- --testPathPatterns=Modal` passes (3 workers).
- [x] 4.2 Run the hel1774 spec green (375, 390x844, 1280; light and dark); verify transcript in evidence.
- [x] 4.3 Run mutations (a) shared rule removed, (b) shared + HEL-1763 group rule removed; verify each is red as Decision 4 states and the file is restored.
- [x] 4.4 Run the Decision 5 regression specs in full plus Modal/BottomSheet jest tests; verify all pass (C11 flakes named if hit).
