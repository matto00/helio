## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `2963aba5ffc8088a574f1f4ca708b3c5b26a7231`. Review base resolved live with
`resolve-review-base.sh` (exit 0): `f3490d1d8c81a5082c973c21462ace3089d7183a`. One commit on the branch.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/panel-placement-layout-version/HEL-1525`.

### What I verified (with evidence)

**AC1. Create, duplicate and batch responses carry the new `layoutVersion`.**
- Code: `PanelLayoutPlacement.insertAndAppend` (PanelLayoutPlacement.scala:51-59). It runs the `FOR UPDATE` read, the
  insert and the layout UPDATE, then `.andThen(dashboards...map(_.layoutVersion).result.head)` and maps every placed
  item to `Some(version)`. All three callers wrap it in `.transactionally` (PanelMutationRepository.scala:27-29, 75-79
  and 173-176). So the version is READ BACK in the same transaction while the row lock is still held, not computed in
  Scala. `PlacedLayouts` is constructed in one place only (CreatePlacement.scala:86, `None`), so no `0L` can ever be
  serialised.
- Routes: `placedResponse` copies the version (PanelRoutes.scala:63). The batch route clears it on the items and puts
  `created.headOption.flatMap(_._2.layoutVersion)` at the top level (PanelRoutes.scala:85-90).
- Live probe against the running backend (:9864), throwaway user `hel1525-skeptic-*@example.test`:
  v0=0, then create 201 `layoutVersion` 1 (dashboard read 1), duplicate 201 → 2 (read 2), batch of 3 → 201 top-level
  3 with 0 items carrying the key (read 3). Racing writer: a layout PATCH at n=3 → 200, then a create → 5 (N+2).
- Backend specs, run by me: `sbt "testOnly ...DashboardLayoutVersionSpec ...PanelBatchCreateSpec"` → 25 succeeded,
  0 failed, `[hel1468-guard] failed=0 aborted=0`. This includes all 5 new "placement responses" cases.

**GET/list/PATCH panel JSON is unchanged.** `layoutVersion: Option[Long] = None` is the last field of
`PanelResponse`. `jsonFormat12` has no `NullOptions` mixed in (grep), so `None` is omitted and the field order of
existing keys does not change. Only `placedResponse` sets it. Live: `GET /api/dashboards/:id/panels` before and after
the placements and `PATCH /api/panels/:id` have no `layoutVersion` key.

**Schemas match the wire.** I loaded every `schemas/**` file into Ajv 2020 and validated the LIVE create, duplicate,
batch and PATCH bodies: all valid. A string `layoutVersion` is rejected, so the new property is really typed.
`npm run check:schemas`: in sync (123 checked).

**AC2. Adopt only when consecutive; I1 under the new rule.** Slice (dashboardsSlice.ts:353-364): the store version
moves only when `placedLayoutVersion === store + 1` AND every breakpoint grew. Hook (useLayoutSave.ts:204-219): class
3 only, the store version changed this render (`prevStoreVersionRef`) AND it equals `persistedVersionRef + 1`.
Constraint C1 holds: `prevStoreVersionRef` is written only inside the layout effect (lines 184-185), not in the
every-render effect at 135-137.

I traced I1 independently:
- A +1 response proves the server was at the client's version right before the create. So server@v+1 = server@v +
  exactly the placed items = the extended baseline.
- A racing writer gives a response of v+2 or more, so neither the slice nor the hook moves.
- When the store version lags the hook baseline (a non-adopted PATCH response, `keepLocalLayout`), the server is
  already past the baseline, so any create response is at least B+2 and nothing is adopted.
- If two creates' dispatches batch into one render, the store version is v+2, which is not B+1, so the hook does not
  adopt (safe, one extra 409).
- A class-3 repair (HEL-1233 shape a) whose response is exactly B+1 can now advance the hook version. That is sound,
  because that layout IS the server layout at B+1. No unsound path found.

**Red-first proof (my own, in a scratch copy, never in the worktree).** I copied HEAD's `frontend/` with
`git archive` into the session scratchpad and symlinked `node_modules`:
- At HEAD: the new grid suite and the reducer suite → 17/17 pass.
- With the BASE `useLayoutSave.ts` (f3490d1d8) and everything else at HEAD: "create then drag" and "duplicate then
  drag" FAIL with received `[[1,409],[2,200]]` against expected `[[2,200]]`. So AC3's test really detects the extra
  409.
- With an "always adopt" mutation (the slice condition replaced by `true`, the hook `+1` check replaced by `true`):
  the I1 test FAILS (`layoutVersion` expected 1, received 3). With that store assertion also removed, it STILL FAILS on
  the behavioural call list (the `[1,409]` round trip is missing). So AC4's test catches a concurrent-writer I1
  violation through the wire behaviour, not just through store internals.

**AC3 / AC4 tests exist and pass:** `DesktopPanelGrid.placementVersion.test.tsx`. The fake server enforces
`expectedLayoutVersion` exactly as the real one does. Related suites
(`DesktopPanelGrid|dashboardsSlice|useLayoutSave|panelPlacement|panelThunks`, 3 workers, nice 19): 15 suites / 99
tests pass.

**Other gates, re-run by me:** `npm run typecheck` clean. `eslint --max-warnings 0` on the changed frontend files
exits 0. `prettier --check` on the changed files and schemas is clean. The evaluator's full jest and sharded
`sbt testFull` totals are pasted with counts and method; I relied on them for the untouched areas.

**Scope.** `git diff --name-only base...HEAD | grep -c ^helio-mcp/` → 0. There is no migration. The follow-up HEL-1539
(DELETE) exists in Linear with the Follow-up label and relatedTo HEL-1525.

**UI / design judgment:** no visible UI surface changed (state and wire only). There is nothing to judge against
DESIGN.md, so I took no screenshots. The servers were already up (`assert-phase.sh servers` → PASS) and were used only
for the wire probe.

**Cleanup:** the throwaway user was deleted with `buildUserDeleteSql([{id, email}])` by exact (id, email). A
follow-up `SELECT count(*) FROM users WHERE id=…` returned 0.

**Gate-defect check (CON-160):** no report I relied on discloses unsound evidence mtimes, and no claim here rests on
mtime ordering. Nothing to record.

### Verdict: CONFIRM

### Non-blocking notes
- `DashboardLayoutVersionSpec` "omit the version on an empty batch" is vacuous: an empty batch is always a 400, so the
  `Created` branch never runs. Rename it, or assert 400 directly. (The evaluator noted this too.)
- `PanelResponse.fromDomain` gained a `layoutVersion` parameter that no caller uses; `placedResponse` uses `.copy`
  instead. Use one or the other.
- `files-modified.md` lists full repo-relative paths, as the executor template prescribes, and the list is complete:
  14 entries matching the 14 non-openspec files in the diff. If the driver's "full paths" rule means absolute paths,
  prefix them.
- PR body: the `dashboardsSlice.ts` / `types/panel.ts` 499-line split note, and the HEL-1524 note that the batch
  response gains an optional top-level `layoutVersion`.

Follow-ups filed by this gate: none. HEL-1539 was filed earlier.
