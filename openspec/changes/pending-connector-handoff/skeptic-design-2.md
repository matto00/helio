## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold spawn. Every finding below is derived from the tree and the current artifacts, not from round 1's
narrative; round 1's report was read only to use its three CRs as a checklist.

### Round 1 CRs — all three genuinely closed

**CR1 (`rotateCredential`) — CLOSED.** Ground truth re-confirmed: `ConnectorRepository.rotateCredential`
(`backend/src/main/scala/com/helio/infrastructure/persistence/sources/ConnectorRepository.scala:125-156`)
mints a credential, repoints `credential_id` (138), then `credentialRepo.delete(existing.credentialId, …)`
(144) — a second bind path onto a pending Connector. design.md D4a now decides it explicitly (refuse,
400-class, rotation-is-not-completion, with the alternative named and rejected), tasks 3.5 implements it,
8.3a tests it, and connector-management gains the scenario "Credential rotation refuses a pending
Connector" whose THEN clause names the exact hazard (no outstanding token left live against a usable
Connector). This is a decision, not an acknowledgement.

**CR2 (`delete` + `WorkspaceContextService`) — CLOSED.** `delete` at `ConnectorRepository.scala:182-196`
does call `credentialRepo.delete(existing.credentialId, user.id)` (196); D4a makes that conditional on the
`Option` and ties it to cascade, tasks 3.6 requires a test, and connector-management adds "A pending
Connector can be deleted by its owner". The Context line is corrected: design.md:10-13 now says exactly
three `findById*` callers and calls out `WorkspaceContextService` as a `findAll` caller instead — which
matches the tree (`WorkspaceContextService.scala:253` `repo.findAll(user).map(_.map(ConnectorSummary.fromDomain))`).
Tasks 3.7 names the call site and carries `pending` into the agent projection. (Nit: the artifacts cite
"246-247", which is the doc comment; the call is at 253. Harmless.)

**CR3 (token-in-model-context threat + expiry value) — CLOSED.** design.md:137-153 is a real threat
statement in the required shape: adversary (anyone reading the agent transcript or its logs), capability
gained (bind an attacker-chosen credential and thereby complete the owner's Connector), capability NOT
gained (no secret is readable; the token addresses exactly one credential-less Connector), mitigations, and
an explicitly accepted residual risk with its detection story. The expiry has a value (15 minutes) in
Risks, Planner Notes and task 4.4. The new authenticated-non-owner control exists in tasks 4.5, in the
completion-token spec as a scenario, and is correctly paired with "An unauthenticated completion is
permitted" so it does **not** break the out-of-band purpose the ticket exists for. No round-1 CR survives;
no escalation is warranted on that axis.

### My own checks

- **`RestSourceConnectorMigration:131` classification is right, and the write-site set is complete.**
  `grep -rn "\.create(" backend/src/main/scala/com/helio/services/sources/` returns exactly three
  `connectorRepo.create` sites: `RestSourceConnectorMigration.scala:131`, `ConnectorEntityService.scala:83`,
  `SourceService.scala:138`. The first passes `ImplicitConnectorConfig.forLegacySource`'s tuple straight
  through, so it always mints a credential row — a write site, never a chokepoint, as tasks 3.8 says. The
  second is the direct authenticated path, held unchanged by the connector-management scenario "The direct
  create path still requires a credential" and the proposal's non-goal. The third (bare-`url` synthesis)
  also goes through `ImplicitConnectorConfig`, so tasks 3.8's "and `ImplicitConnectorConfig`" covers it —
  but only by implication; see note 1.
- **Design.md length.** 184 lines. The overage is D4a (17 lines) plus the threat bullet (17 lines), both
  added at this gate's own request. Removing either would undo CR1/CR2/CR3. I find no fat worth cutting;
  the Context, Decisions and Migration Plan are all dense. Overage justified, declaration appropriate.
- **15 minutes + non-owner control vs. the out-of-band purpose.** Coherent, with one unhandled consequence —
  CR1 below.
- **`Option`-not-status-column, the `share_tokens` mirroring, atomic conditional consume, the recording-repo
  evidence requirement, "no failure path costs an extra query"** — all re-checked against
  `ConnectorRepository`/the specs and all hold.

### Verdict: REFUTE

One change request. It is not a round-1 survivor — it is a new interaction created *by* the round-1 fixes.

### Change Requests

1. **After the 15-minute expiry there is no way to complete a pending Connector, and nothing in the plan
   says so or provides a recovery path.** The round-2 revisions closed three doors simultaneously:
   `rotateCredential` now refuses a pending Connector (D4a / task 3.5), the token is hard-expiring at 15
   minutes and single-use (D2/D3, task 4.4), the owner status endpoint was dropped (task 4.4), and no
   artifact anywhere mentions re-minting — `grep -rni "re-mint\|re-issue\|regenerat\|recover"` over the
   change dir returns nothing. So a human who opens the URL at minute 16 hits a permanently dead
   Connector: it cannot be completed, cannot be rotated into usefulness, cannot author a source, and the
   agent's only move is to call `create_connector` again, accumulating another pending row each time
   (there is no reaper — Risks accepts that). Fifteen minutes is short for a flow whose defining property
   is that the human is *elsewhere*, so this is the expected path, not the edge case.
   Decide it here, in design.md, rather than letting the executor improvise: either (a) state explicitly
   that an expired token strands the pending Connector, that the recovery path is owner-deletes +
   agent-re-initiates, and require a task + test that this actually works end to end (delete is already
   task 3.6; the agent-side message from task 5.3 must then say this); or (b) allow the owner to re-mint a
   token for a pending Connector they own (an authenticated, owner-scoped mint — note this does *not*
   weaken the threat model, since the new token is disclosed to the owner's own session, not to the agent).
   Whichever is chosen, the completion-token spec needs a scenario for it, because "the completion URL
   expires, and expiry behavior is specified and tested" is a ticket acceptance criterion and the current
   spec specifies only that an expired token authorizes nothing — not what the owner does next.

### Non-blocking notes

- **Name `SourceService.scala:138` alongside `RestSourceConnectorMigration:131` in task 3.8.** It is the
  second `ImplicitConnectorConfig` synthesis point and the second-most-likely place for a pending row to
  leak in by accident; the task covers it only through the shared helper's name.
- **"a hard 15-minute expiry" (design.md:147) vs "overridable by configuration" (task 4.4).** The residual
  risk in the threat statement is computed against 15 minutes; if the value is operator-tunable it is not
  hard. Either drop "hard" or state a maximum the configuration cannot exceed.
- **proposal.md contradicts D4 on the SQL path.** "What Changes" bullet 2 says every chokepoint rejects a
  pending Connector including "the SQL path"; D4 and task 3.3 correctly establish `SqlConnectorDriver` is
  not a chokepoint at all (it holds no `ConnectorRepository`). Fix the proposal wording so the executor
  does not go looking for a guard that has nothing to guard.
- The design cites `WorkspaceContextService` "246-247"; the `findAll` call is at line 253.
