## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **The defect is real and exactly as described.** `SourceService.scala:133-142` constructs
  `RestApiConfig(connectorId, endpoint, method, queryParams, headers, body, bodyContentType, rootSelector)` —
  `parameters` is absent. `domain/model/model.scala:534` declares `parameters: Map[String, String] = Map.empty`,
  so the omission compiles silently. Root cause is probe-confirmed by reading, not narrative.
- **The fix's exact form type-checks against ground truth.** `RestApiConfigPayload.parameters` is
  `Option[Map[String, String]] = None` (`DataSourceProtocol.scala:168`), so D1's
  `request.config.parameters.getOrElse(Map.empty)` matches the sibling `headers` idiom on the same lines.
- **The test premise holds.** `RestApiConnectorDriver.scala:177-186` resolves endpoint, queryParams, headers and
  body against `config.parameters`, so a persisted-empty map genuinely produces the unresolved-variable failure
  the plan makes its red signature — the red is a real defect signature, not a fixture artifact.
- **The harness the plan copies exists and does what the plan claims.**
  `SourceServiceBareUrlQueryParamsSpec.scala` (124 lines) starts its own `EmbeddedPostgres` (line 57) + Flyway
  (58), calls `SourceService.createRest` (102), and fetches through a driver with **no** `fetchOverride` against a
  real bound server (108-119). D2/D3's claims about it are accurate.
- **No Flyway migration is implied.** `parameters` is an existing field of the JSON config blob, not a column;
  `git status` shows no migration files and the only untracked path is the change dir itself. The spec's harness
  is embedded Postgres, so the shared dev DB and the concurrent HEL-987/HEL-985 runs are untouched. Task 4.2
  additionally makes an apparent need for a migration an escalation trigger.
- **Vacuity risk is addressed, and addressed at the right layer.** D5 makes the acceptance-bearing assertion the
  query string and headers a real bound server received (a fix that stores but never resolves would still fail),
  with the persisted-map check demoted to a secondary localiser. D4 mandates evidenced red-first ordering plus a
  revert-the-one-line mutation check with the *same signature*, and explicitly disqualifies a compile error or
  fixture mismatch as the red. This is exactly the discipline the repo's fixture-history demands.
- **The stated caller story checks out.** `PipelineProposalService.scala:360` builds the create request via
  `ProposalRestApiConfig.toRestApiConfigPayload`, which does carry `parameters`
  (`PipelineProposalProtocol.scala:101`). So the agent-authored proposal path really does supply a `parameters`
  map that `SourceService` then discards — the drop is localized to the one branch being fixed, and no upstream
  co-defect makes the fix ineffective.
- **No unaddressed sibling collapse point on a persisting create path.** The other `RestApiConfig(...)` sites are
  decode/sentinel (`DataSourceConfigCodec`, `DataSourceRepository:58`) or the legacy migration
  (`RestSourceConnectorMigration.scala:141`), which reconstructs from a stored legacy blob that has no
  caller-supplied `parameters`. Task 2.2 already directs the executor to check and record that finding.
- **Artifact hygiene.** No TODO/TBD/placeholder; proposal, design and tasks agree; every AC in `ticket.md` maps to
  a task (AC1 → 1.2/3.1, AC2 → 1.3/3.2); spec delta adds the create-time obligation as a MODIFIED requirement with
  a matching scenario, and correctly preserves the ephemeral bare-`url` carve-out rather than contradicting it.

### Verdict: CONFIRM

### Non-blocking notes

1. Task 2.2 names only `RestSourceConnectorMigration.scala`. Ground truth shows four other files construct
   `RestApiConfig(...)`; none is a persisting-create path, but the executor should state that enumeration (not
   just the one file) when recording the finding, so "I checked" is auditable.
2. D4's red signature admits two forms (unresolved-variable error, or literal `{{...}}` reaching the server).
   Only one can actually occur given the driver's guard at `RestApiConnectorDriver.scala:177-186` — the executor
   should record which one it observed and treat the other appearing as a signal to re-examine, not as a pass.
