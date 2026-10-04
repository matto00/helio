## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 5dff25bcc2196ed777f060be29dd7b41a12a30eb

### Phase 1: Spec Review — PASS
Issues: none.
- AC1: JoinStep `authorable=false` removed; "Join tables" offered in palette and added live (201).
- AC2: JoinConfig renders SecondaryInputPicker ("Right source"), "Join key" select, INNER/LEFT toggle. Verified live.
- AC3: onJoinChange persists exactly {secondaryInput, joinKey, joinType}; joinConfigOf is full passthrough (lane, unknown joinType, absent key rendered honestly via notice / "(not in input)" option).
- AC4: JOIN_OP_TYPE and its special case removed; comment rewritten.
- AC5: shared fixture read by three legs; helio-mcp description updated.
- AC6: verified live (below). AC7: groupby/HEL-1251 untouched.
- C1: red under key-rename mutation reproduced by me for frontend and helio-mcp legs (below).

### Phase 2: Code Review — PASS
Gates (own fresh runs in WORKTREE_PATH):
- `npm run lint`: clean. `npm run format:check`: clean. `npm --prefix frontend run build`: OK.
- `npm test`: root 36 suites / 353 tests pass; frontend 413 suites / 4304 tests pass.
- `nice -n 19 sbt testFull`: 5600 run, 4 failed, all in ExistenceNotLeakedRoutesSpec (known 1s RouteTest timeout flake class). Re-ran that spec plus JoinStepConfigSeamSpec: 63/63 pass. sbt server shut down separately.
- e2e `hel958-join-step-editor.spec.ts` against DEV_PORT=6390: passes.
Code: small, mirrors lookup/union conventions, no dead code, no new CSS (reuses existing classes), no escape hatches. No CONTRIBUTING violations found.

Item 4 (fallback fixtures): StepCard tests were only repointed to a synthetic `noeditor` op with identical assertions (label-derived text), so the no-editor fallback branch is still exercised and non-vacuous. The provenance tests moved join -> groupby, which is still absent from OP_TYPES and still asserts the humanised fallback ("Groupby"); intent preserved.

Item 5 (C1 reds, my own): renaming `joinKey` -> `join_key` in the shared fixture: frontend JoinConfig.seam 2/2 fail; helio-mcp joinStepSeam 1 fails. Mutating `joinKey` key in `onJoinChange` fails the frontend seam suite at compile time (ts-jest TS2353) -- red, though type-level rather than assertion-level. Backend leg's red not re-run by me (heavy); the leg reads the same fixture. All mutations reverted (git status clean).

### Phase 3: UI Review — PASS
Servers via start-servers.sh/assert-phase (PASS). Verified `location.href` = http://localhost:6390/pipelines/... at capture. Note: mid-review the shared Playwright browser was navigated by another lane to http://[::1]:6610/login; my cleanup DELETEs from that page returned 403 (no effect) and I redid the cleanup via curl against my own port.

Item 3 (UI path, live, fresh user/sources): Add step -> "Join tables" -> Right source "Data source: Eval Right" -> Join key "id" -> INNER; each persisted; analyze preview showed `+ right_name`, `+ city`. Then, entirely via UI: "Add output" dialog (name, Kind=Table, Save) and the "Run pipeline" button. Output rows from /api/outputs/<id>/rows: {id1,ann,10,right_name ANN,city Oslo}, {id2,bob,20,right_name BOB,city Rome}; total 2 (3 and 4 dropped) -- real rows incl. HEL-1236 right_name prefix. Run chip "Succeeded". Verdict on e2e shortcut: creating the Output via API is acceptable, since the Output is not part of the join editor and the UI Output flow exists and I exercised it live above; the e2e still builds the join through the UI, finds the UI-made step, runs, and asserts exact row values. Minor note: the e2e leaves its registered user/sources/pipeline in the dev DB (unique-email, not cleaned); non-blocking.

Item 1 (screenshots, fully configured, no transient notice): light and dark, persisted:
- /home/matt/Development/helio/.concertino/runs/HEL-958/evidence/hel958-eval-join-light.png
- /home/matt/Development/helio/.concertino/runs/HEL-958/evidence/hel958-eval-join-dark.png
- /home/matt/Development/helio/.concertino/runs/HEL-958/evidence/hel958-eval-dark.png (Union + Join cards)
Both themes render cleanly; no console errors beyond a pre-existing 1 error present from page load before any join interaction (auth-less probe on /login).

Item 2 (dark header strip): not a regression. The diff touches no CSS and not StepCard.tsx. In the running app the sibling Union card's expanded header button shows the same dark strip (computed bg rgb(22,21,20) on the Union header button), while the unfocused Join header is transparent; it is a shared header-button focus/hover background, pre-existing. Join card in dark screenshot shows no strip.

Breakpoint sweep (1100/768/0) not exhaustively run; no new layout CSS was added, so risk is low.

### Overall: PASS

### Non-blocking Suggestions
- Clean up the e2e's registered user/sources (or document the residue convention) to avoid dev DB residue.
- Consider an assertion-level (not only compile-time) frontend seam red, e.g. cast the mutation, so the leg stays red if the type changes.
- The dark header-button strip on focus (pre-existing) could be a separate ticket.
