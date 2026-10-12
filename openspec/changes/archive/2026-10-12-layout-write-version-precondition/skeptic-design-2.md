## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed cold against the live tree at HEAD 84d8913e7db234bc0b38d09bc23a6b292ec19f0a (planning artifacts untracked;
no code changes yet). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/layout-write-concurrency-precondition/HEL-1457`.

### What I verified (with evidence)

- **DashboardRepository** (`DashboardRepository.scala`): `update` :164-175 writes `(name, lastUpdated, appearance, layout)`
  under `withUserContext(dashboard.ownerId)`, no lock or precondition; `updateLayoutIfUnchanged` :190 is layout-only CAS;
  `updateName` :208 is system-context `(name, lastUpdated)` plus re-read. Only callers of `dashboardRepo.update` are
  `DashboardWrites.scala:80,92` and `AutoLayoutService.scala:99` (grep). Design Context is accurate.
- **DashboardWrites**: `applyUpdate` reads `panelIdsInternal`, resolves the layout before any write (HEL-1071), then
  `writeUpdate` does `updateName` then a full-row `update` (or just a full-row update). That confirms the rename-revert and
  lost-placement paths. D3 (one transaction, supplied fields only, CAS first) closes both.
- **AutoLayoutService** :86-107: unlocked read, pack, full-row `update`; the HEL-1485 comment explicitly defers this
  window to HEL-1457. D5 matches.
- **PanelLayoutPlacement** :47: dashboard row `FOR UPDATE`, then a layout-only `(layout, lastUpdated)` write. Under D1 the
  trigger bumps the version, so a stale CAS misses (READ COMMITTED re-evaluates `WHERE layout_version = ?` after the lock wait).
- **DashboardContentsOps.replaceContents**: unlocked read, writes `layout.getOrElse(existing.layout)`. The design now
  names this correctly as a residual (round-1 note fixed). Its panel delete fires V122 and bumps the version, so a stale
  client save after it gets a 409, as claimed.
- **V122**: SECURITY DEFINER, `SET search_path = pg_catalog, public`, `ENABLE ALWAYS`, and its UPDATE writes only when
  `layout IS DISTINCT FROM`. A `BEFORE UPDATE ... WHEN (NEW.layout IS DISTINCT FROM OLD.layout)` row trigger fires inside
  it and bumps the version. The claim that this closes HEL-1485's ghost window holds whenever the deleted panel had layout items.
- **Migration number**: origin/main tops out at V125 (`git ls-tree origin/main`), so V126 is free. C2 carries the
  re-check instruction.
- **ServiceError rendering**: `ServiceError` is sealed; `ServiceResponse.statusCodeFor` is the only exhaustive match
  (grep). `completeError` already special-cases variants with bespoke bodies (`TooManyRequests`,
  `StepConfigInvalid`), so `LayoutConflict(current) -> 409 {message, dashboard}` follows existing precedent. The same
  CAS-to-Conflict precedent already exists at `DataSourceService.scala:937` (row `updatedAt`).
- **Protocol**: `UpdateDashboardRequest` and `AutoLayoutRequest` are `jsonFormat3`, which ignores unknown keys, so
  route-level raw-JSON tests carrying `expectedLayoutVersion` are red on main and green after. `/update` passes
  `request.dashboard` through unchanged.
- **Client** (`useLayoutSave.ts`, `dashboardsSlice.ts`): `updateDashboardLayout.fulfilled` :336 and
  `repairDashboardLayout.fulfilled` :352 keep the local layout by reference in their non-adopt branch. The hook sets
  `persistedLayoutRef` at class-4 re-baseline :162, placement extension :156, and the `.then` :204. The thunk's catch
  :169-180 refetches the list and upserts. `isLayoutValid` exists (`breakpointLayout.ts:37`), so "existing client
  validity check" is real.
- **I1 under D7a/D7c (round-1 CR1)**: traced the flows below and found no case where the client sends a version that
  covers another writer's item its layout lacks.
  - Normal success: CAS guarantees the response is exactly base+sent, so advancing is correct.
  - Placement extension: the version stays old, giving a 409 and a rebase (D7e names this).
  - Retry success with store == sent: the reducer and the hook both adopt the paired response.
  - Retry success with store != sent: the store keeps the old version and the hook keeps the old pair. The next flush
    gets a 409 and rebases again, with base = old baseline, so both drags count as user changes.
  - Rename/appearance/fetch landings: the store gets a server pair, which is consistent.
  - Task 4.3 pins the in-flight second-drag case.
- **Red-first tests (round-1 CR2)**: in 1.1, `pg_stat_activity.wait_event_type='Lock'` forces the PATCH's read and
  resolve to happen before the competing commit. On main the full-row UPDATE then overwrites, so the test is red;
  after the fix the CAS misses and returns 409. The rename case is red on main (name reverted) and green after (the
  rename does not change layout, so the version is unchanged and the CAS succeeds without touching name). 1.2 asserts
  only what D4 can deliver.
- **AC coverage**: each AC is covered by at least one task.
  - AC1 (precondition + 409 + refetch/reapply-or-inform): D2/D4/D5/D7, tasks 3.3-3.6 and 4.1-4.3.
  - AC2 (no name/appearance rewrite): D3/D5, tasks 3.2-3.4.
  - AC3 (tests): 1.1, 1.2 and 5.1, with the agent-placement and rename cases named.
  - Driver constraints: carried as C1-C5. No TBDs or placeholders.
- **Lock order**: CAS adds no panel-row locks and the D3 transaction touches only the dashboard row, so the HEL-1485
  order is not widened.

### Verdict: CONFIRM

D4 (optional precondition plus bounded retry) and D7 (rebase-then-inform) are internally consistent. They are the
declared OWNER REVIEW product calls, and I did not judge the calls themselves.

### Non-blocking notes

1. **D4 wording overclaims.** "they can no longer clobber a write that landed mid-request" is only true for name,
   appearance and unsent breakpoints. On retry, a no-precondition caller's supplied breakpoints still replace whatever
   landed. That includes `RestorePriorStored` full-layout inverses, which re-write every breakpoint. Spec and task 1.2
   are already correct; align the D4 sentence.
2. **Server-side hardening (cheap).** D2 uses the caller's `expectedLayoutVersion` as the CAS token, but merges against
   the `existing` row read at version Vr. A forged `expected > Vr`, with a concurrent write moving the stored version to
   `expected`, would CAS-succeed with a layout merged on a stale read. Honest clients can't hit this, because versions
   only increase, so Vr >= any version they observed. Still, prefer an early 409 when `expected != existing.layoutVersion`,
   then CAS on the read version. That makes "never overwrite a layout it did not read" unconditional.
3. **Hook `.then` in the normal (non-retry) keep-local case.** It advances the version to the response even if a server
   landing (rename/appearance response, a late list fetch) re-baselined the store mid-flight with an older pair. With
   CAS the only exposure is a stale fetch older than the sent base, which is exotic and similar to the existing
   class-4 behaviour. Consider advancing the version only when `latestLayoutRef` is still derived from `sentLayout`.
4. **Inserts.** `insert` (and duplicate/import, if they `copy` a source dashboard) will write `layout_version` through the
   full-row projection, contradicting "app code never writes the column". It's harmless, but either exclude it from the
   insert projection or reset it to 0 on new rows.
5. **Construction sites.** `UpdateDashboardRequest` has three positional construction sites
   (`DashboardProposalService.scala:183`, `PatchSetUndoInverse.scala:96`, `PatchSetApplyRollback.scala:344`). Append
   `expectedLayoutVersion` with `= None`, as D6 already specifies for the domain field.
6. **Tasks housekeeping.** Task 3.3 says "409 `Conflict`" while D2 and 3.6 say `LayoutConflict`; use the one variant.
   Tasks 3.6 and 3.5 are out of order. Neither is ambiguous.
7. **File the follow-ups.** The round-1 note still applies. Neither tasks nor proposal commit to filing the helio-mcp
   precondition ticket, the "version on placement responses" ticket, or the `replaceContents` residual ticket.
   File and link them at delivery so the OWNER REVIEW residuals have owners.
