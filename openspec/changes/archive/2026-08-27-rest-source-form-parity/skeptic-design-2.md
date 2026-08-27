## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Worktree HEAD verified `f73cee3a` (unchanged from round 1; only the change dir is untracked).
Every claim below was re-derived from the live tree, not from the executor's narrative.

### What I verified (with evidence)

Each round-1 change request, re-checked against the revised artifacts AND the code:

1. **`endpoint` / mutual exclusivity — ADDRESSED.** design.md Context now has a dedicated
   paragraph citing `SourceService.createRest:80-88` (hard 400 on both/neither) and
   `DataSourceProtocol.scala:356` (`p.endpoint.getOrElse("")` on the `connectorId` branch),
   and specifies the "Endpoint path" label/placeholder + read-only `baseUrl` prefix. The
   enumeration table has an `endpoint` row. Task 1.1 adds `endpoint?: string` to
   `RestApiConfigBody`; task 3.1 replaces the URL input outright. Re-verified the backend
   facts myself — accurate.
2. **All three config builders — ADDRESSED.** New Decision 1a mandates a single
   `buildRestSourceConfig(formState)`, and task 1.3 names all three call sites. I confirmed
   the three sites exist and duplicate the field list today: `AddSourceModal.tsx:102-145`
   (`handlePreview`), `:149-172` (`handleCreate`), plus `RestApiForm.buildConfig()`. The
   design's `handleSubmit`/`handleCreate` phrasing now correctly names `handleCreate`.
3. **Client wire type — ADDRESSED.** Context states explicitly that `RestApiConfigBody`
   "does **not** yet declare `endpoint`, `queryParams`, or `parameters`"; proposal.md Impact
   repeats it; task 1.1 names all three with `parameters?: Record<string,string>`.
4. **Nonexistent edit form — ADDRESSED.** Non-Goals, Decision 4, tasks 4.1/4.2 and the spec
   scenario all now state `RestApiForm` is create-only and verify via migration-check +
   schema preview + pipeline run. `grep -rl RestApiForm frontend/src` still returns only
   `AddSourceModal.tsx` (+ test) — the claim is true.
5. **Migration coverage — ADDRESSED in the load-bearing places** (Decision 4 and Risks now
   scope it to "owned, well-formed legacy rows" and state that branches 3/4 (ownerless /
   malformed) remain legacy-shaped and un-authorable, with an explicit acceptability
   argument; task 4.1 says "owned, well-formed"). One stale sentence survives in Context —
   see non-blocking note 1.
6. **`CreateConnectorModal` — ADDRESSED.** Decision 1 + task 2.2 add an optional
   `onCreated?: (connector: Connector) => void`; proposal.md Impact/What-Changes now list the
   modal as modified. I confirmed feasibility: `CreateConnectorModal.tsx:65-68` already holds
   `result.payload` (a full `Connector`) inside the `createConnector.fulfilled.match` branch,
   and `ConnectorsPage.tsx:200` is the only other usage (passes `onClose` only), so the prop
   is genuinely backwards-compatible. Modal-in-modal stacking is now addressed (Decision 1,
   task 2.3); `Modal.tsx` uses native `<dialog>`/`showModal()` with an explicit Tab trap
   (`:122-155`), which stacks and restores focus natively — so task 2.3 is executable.
7. **Decision 3 rationale — ADDRESSED.** Now rests on the MCP tool's surviving *no-auth*
   bare-`url` shape, and the enumeration table's `auth` row reads "accepted by the tool's
   schema, but rejected by the server ... since HEL-822". The "not re-verified live" hedge is
   gone, replaced by an in-repo citation to `helio-mcp/src/tools/write.ts:132-139`.
8. **Spec tautology — ADDRESSED.** Requirement 4 now reads "SHALL require a Connector ...
   and SHALL NOT ever submit a create request carrying a bare `url` with no `connectorId`" —
   no longer self-weakening, and consistent with task 3.3/2.1.
9. **`AddSourceModal.tsx` file size — ADDRESSED.** Context and Decision 5 both name the
   534-line figure against CONTRIBUTING.md's ~250-line budget and plan a
   `useRestSourceForm` hook that lifts all REST state + the composer out of the modal;
   task 1.2/3.4 encode it.

Additional checks of my own this round: `connectorsSlice` exports `fetchConnectors`/
`createConnector`; `Connector` carries `name`/`kind`/`baseUrl`, so the "show name and kind"
requirement is satisfiable; all seven ticket acceptance criteria trace to at least one task
(AC1→design table, AC2→2.4, AC3→1.3+spec R3, AC4→3.3, AC5→5.2, AC6→2.1/3.2/3.4, AC7→4.1/4.2).

### Verdict: CONFIRM

All nine round-1 change requests are substantively resolved, and the two that would have
produced a form that 400s on every save (CR1 `endpoint`, CR2 the three builders) are now
explicit in both design.md and tasks.md. The plan is implementable as written.

### Non-blocking notes

1. **Stale sentence in design.md Context.** The paragraph beginning "`RestSourceConnectorMigration`
   (HEL-822) runs at boot and idempotently converts **every** legacy ... row" and asserting
   "every existing source in a running deployment is already migrated" survives verbatim from
   round 1, directly contradicting the corrected four-branch paragraph three lines above it and
   Decision 4. No task depends on it and the correct statement is the operative one, so this is
   not blocking — but delete or restate it during execution so the design doc isn't
   self-contradictory in the archive.
2. Risks section cites "the spec (Requirement 2)" for the Connector-required-before-save
   statement; that is spec Requirement 4. Trivial cross-reference fix.
3. Decision 2's duplicate-key flagging and Decision 5's `KeyValueListField` genericity are
   sound; watch that `KeyValueListField` really lands in a shared location if a third consumer
   appears, rather than under `features/sources/ui/forms/` forever.
