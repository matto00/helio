## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

1. **Spawn-cwd guard**: ran `pwd -P` alone, then `assert-cwd.sh` against WORKTREE_PATH/BRANCH —
   `READY ambient=/home/matt/Development/helio branch=feature/output-panel-control-config/HEL-1189`.
   Proceeded normally.

2. **Fresh read of every artifact** in `openspec/changes/output-panel-control-config/`: `ticket.md`,
   `proposal.md`, `tasks.md`, `design.md` (all 150 lines), and both spec deltas
   (`specs/output-panel-placement/spec.md`, `specs/output-panel-controls-editor/spec.md`) — read in
   full, not summarized from prior reports.

3. **Client-generated `id` — does it break anything else in the Panel/PATCH pipeline?**
   - Read `backend/.../domain/panels/FormPanel.scala` in full: `FormFieldSpec` (the codebase's only
     precedent for a "list of typed, kind-discriminated specs" persisted in panel config) has *no*
     `id` field at all — it's keyed by `sourceField` uniqueness instead. This confirms design.md's own
     claim ("mirrors nothing in `FormFieldSpec`... because controls have no such natural key") is
     accurate, not hand-waved.
   - Read `PanelRowMapper.scala` lines 119-133: confirmed the exact tolerant-decode-with-log-fallback
     pattern (`form_config` failing to decode → falls back to `Empty`, logged) that task 1.4 commits
     to mirroring for `output_controls`. Real precedent, correctly cited.
   - Read `PanelService.scala` lines 555-614: confirmed `update` at line 563 (`case Some(existing) =>`)
     genuinely holds the pre-patch persisted panel in scope exactly where D4 says it does, and that
     `rejectMissingOutput`/`rejectInconsistentForm` are real methods with the shape D4 models itself
     on (sequential `Future[Either[ServiceError, Unit]]` gates before `patchApplier.apply`).
   - Nothing in this pipeline treats a spec-list-entry `id` as server-issued, unique-across-panels, or
     tied to a DB constraint — `output_controls` is a JSONB blob with no FK/unique index touching its
     internal `id` field, so a client-forged or colliding id has no blast radius beyond the single
     panel's own diff (D4 explicitly re-validates `kind`/`column` regardless of whether `id` was
     judged "new"). Confirmed `crypto.randomUUID()` is an *existing* pattern in this codebase
     (`frontend/src/features/assistant/ui/MessageComposer.tsx:66-118`, message dedup key) — not a
     novel technique being introduced for the first time here.
   - **No new problem found.**

4. **Is client-generation actually required by D6/D7's optimistic flow, or was the AC-driven
   rationale itself sound?**
   - Read `usePanelUpdatesFlush.ts`: confirmed `accumulatePanelUpdate` stages edits into
     `pendingPanelUpdates` *locally*, flushed only on a 30s auto-save tick or explicit "Save now" —
     there genuinely is no server round-trip at the moment "Add control" (click 2) fires. This means a
     server-minted id literally cannot exist yet when the new control must render in the local list
     (React key, subsequent rebind/remove targeting) — the AC-driven rationale is not just plausible,
     it's mechanically forced by the existing accumulate-then-flush architecture. Confirms D2's
     rationale is sound, not post-hoc.

5. **Does this close the id-diff mechanism's dependency cleanly?**
   - Every incoming `controls` entry now has a comparable `id` from its very first appearance (minted
     client-side at add time, never regenerated), and an already-persisted control's id is read back
     unchanged from the server response the editor initializes from — so D4's `id`-diff against
     `existing` has a real id on both sides in every case. No remaining gap.
   - Checked for stale "server-assigned" language elsewhere in the change dir: the only two
     remaining occurrences are in `skeptic-design-2.md` itself (the historical report describing the
     prior finding, correctly left as-is) and the explanatory clause in design.md D2 quoting round
     2's own finding for context. `proposal.md`, `ticket.md`, and both spec deltas consistently say
     "client-generated" — verified by direct grep, not by trusting the executor's summary.

6. **`openspec validate` and line budget**: ran `npx openspec validate output-panel-control-config
   --type change --strict` fresh → `Change 'output-panel-control-config' is valid`. Ran `wc -l
   design.md` → `150` — exactly at, not over, the stated 150-line budget.

7. **Broader pass over proposal.md/ticket.md/tasks.md**: no new contradictions, no placeholders, no
   scope drift found. Tasks 1.1-4.6 trace cleanly to design.md's D1-D7 and both spec deltas' AC
   scenarios. Task 3.3 explicitly names `crypto.randomUUID()` for the id-generation task, consistent
   with D2.

### Verdict: CONFIRM

Both round-1 findings (confirmed fixed in round 2, re-verified independently here against real code
rather than trusting either prior report) and round 2's single finding (client vs. server id
generation) are resolved soundly, not just re-worded. The client-generated-id decision is grounded in
an actual architectural constraint I verified directly (`usePanelUpdatesFlush`'s accumulate-then-flush
model has no add-time round-trip), not asserted without support. No new problems surfaced by the
change — `FormFieldSpec` genuinely has no id-collision precedent to violate, `PanelRowMapper`/
`PanelService` citations check out against the actual files, and the id-diff mechanism (D4) has no
remaining gap. `openspec validate --strict` passes; design.md is exactly at its 150-line budget, not
over it.

### Non-blocking notes

- None beyond what's already tracked in the design's own Risks/Trade-offs section (drift-guard test
  discipline, HEL-1194 caching deferral) — both already correctly scoped out of this change.
