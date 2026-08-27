## Skeptic Report — design gate (round 2, skeptic-design-1.md)

(Filename number is 1, not 2: `next-report-number.sh` reports the round-1 report file
was removed during revision. Path is the one the script returned, not a reconstruction.)

### What I verified (with evidence)

Read fresh, not from the orchestrator's summary: `ticket.md`, `proposal.md`, `design.md`,
`tasks.md` in `openspec/changes/connector-domain-model-credentials/`.

- **CR1 (two-transaction honesty).** `backend/src/main/scala/com/helio/infrastructure/persistence/DbContext.scala`
  exposes exactly two entry points, `withUserContext[R](userId)(action: DBIO[R]): Future[R]`
  and `withSystemContext[R](action: DBIO[R]): Future[R]` — **no DBIO-returning variant**.
  `ConnectorCredentialRepository.create(userId, name, plaintext): Future[ConnectorCredentialMeta]`
  (line 32) likewise exposes no `DBIO`. So Decision 2's claim that atomic composition is
  impossible without modifying HEL-536 code is **true as written**. The compensating-delete
  design has a real counterpart: `delete(id: ConnectorCredentialId, userId: UserId): Future[Boolean]`
  (line 84). Accepted orphan row is ciphertext-only — no plaintext-leak path. Sound.
- **CR2/CR3 (naming collision).** Ground truth confirms both files exist and are unrelated:
  `api/routes/sources/ConnectorRoutes.scala` (`pathPrefix("connector-types")`, line 18) and
  `api/protocols/sources/ConnectorProtocol.scala`. `ApiRoutes.scala:677` wires
  `new ConnectorRoutes(authenticatedUser).routes`. Decision 7 adds distinctly-named
  `ConnectorEntityRoutes`/`ConnectorEntityProtocol` and explicitly forbids renaming/touching
  those files (tasks 3.1, 3.5). `JsonProtocols.scala` is confirmed to be a zero-format
  aggregator trait composing per-domain traits — so "new per-domain trait mixed into the
  aggregator" is the correct, existing pattern. proposal.md's Impact section now matches.
  No stale "genuinely additive" claim remains.
- **CR4 (read-path enumeration widened).** Decision 6 backward pass names three surfaces
  (`decryptForUse`, `EncryptedSecretBackend.decrypt`, `MasterKeyProvider.unwrapDataKey` via
  `rewrapAllBelow`/`withSystemContext`); all three exist in the tree
  (`ConnectorCredentialRepository.scala:72,100`; `services/auth/{EncryptedSecretBackend,MasterKeyProvider}.scala`).
  Forward pass now covers all five route responses incl. the 409 error body. Task 4.2 encodes
  both directions as three greps, not one.
- **CR5 (AC5 proof is test-only).** Decision 6a states no route calls `decryptForUse`, and the
  proof runs through an in-process stub HTTP server asserting the exact header value. This is
  consistent with the backward pass (test-only caller) and removes the third-party dependency.
- **CR6 (delete seam).** Decision 4 + tasks 2.1/3.4/4.6 define
  `delete(id, dependentCount: ConnectorId => Future[Int] = _ => Future.successful(0))`, with
  4.6 exercising the real route/repository with a nonzero-count collaborator. The 409 branch is
  genuinely reachable today rather than dead code. HEL-822 hand-off is explicit.
- **Migration slot.** `V92__connector_credentials.sql` is the highest existing migration; `V93`
  is free.
- **RLS pattern fidelity.** V92 uses `CREATE POLICY ... USING (...)` with a deliberate no-`WITH
  CHECK` comment (lines 10, 35–37); V35 uses the same `USING`-only form for `data_sources`.
  Decision 1's proposed `connectors` policy matches that established pattern, so "mirroring
  data_sources" is accurate, not asserted.

### Verdict: CONFIRM

All six round-1 change requests are addressed in the artifacts and each load-bearing factual
claim I could check against the tree holds. No placeholders/TODOs, no proposal↔design↔tasks
contradiction found, every AC (1–6) traces to at least one task (4.1–4.6 + 1.x/2.x/3.x), and
scope stays inside the ticket.

### Non-blocking notes

- `ConnectorRepository.create` must supply a `name` to `ConnectorCredentialRepository.create`
  (the signature requires one); no doc states what it should be. Deriving it from the connector
  name is the obvious choice — worth one line in execution so it isn't invented twice.
- Decision 1's V93 SQL block would benefit from carrying V92's explanatory comment that the
  absent `WITH CHECK` means the `USING` predicate also gates INSERT; without it a future reader
  may "fix" it.
- Delete ordering (connectors row first, then the credential) is implied by the `ON DELETE
  RESTRICT` FK but only stated in passing in task 2.1 — make it explicit in the implementation.
