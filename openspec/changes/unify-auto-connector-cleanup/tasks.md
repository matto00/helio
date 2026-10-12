## Standing Constraints

- [C1] Red first: every new test is shown red against unmodified origin/main (or, if green on main by construction, mutation-proven red), recorded in red-evidence.md with the command and output excerpt.
- [C2] New backend specs use `VerifiedEmbeddedPostgres.start`; every sbt run's output must show `[hel1468-guard]`. No inline FQNs.
- [C3] Never log, print or assert-print a credential value, `backend/.env`, or an env map; probes use a throwaway @example.test user and never matt@helio.dev.
- [C4] Resource caps (HEL-1442): `nice -n 19` on heavy jobs, at most one `sbt testFull` from this lane, shut down every sbt server started, run formatters with the worktree as cwd.

## 1. Item 1 -- CsvUploadLimitsRoutesSpec deterministic 413

- [x] 1.0 Probe how the server terminates a pdf-over-cap request (FIN vs RST, Connection: close, timing); record in red-evidence.md; escalate if no race is possible
- [x] 1.1 Forced-ordering repro through the REAL `Http().singleRequest` path (waiting-source gate on server-side connection termination, no sleeps), captured red
- [x] 1.2 Add the race-tolerant raw-socket helper (Connection: close, Host, Content-Length-bounded read, read timeout) for the 413 real-server cases only; success cases keep `postOverHttp`; the repro passes with the new helper
- [x] 1.3 Supporting evidence: 30+ consecutive green runs of the spec (recorded, not offered as proof)

## 2. Items 2+5 -- single auto-Connector rule, log-safe

- [x] 2.1 Red: unified-rule spec (renamed source; InlineSourceCleanup with DataSourceService lacking connectorRepo) for deleteCallCreated and deleteIfUnreferenced
- [x] 2.2 Red: log-safety spec (sentinel in exception message, captured loggers) covering connector-cleanup and source-delete failure lines
- [x] 2.3 Replace all `deleteIfAuto` call sites (SourceService.createRest, InlineSourceCleanup x2) with `deleteIfUnadoptedImplicit`; delete `deleteIfAuto` (and `autoName` if unused); simplify the capture to `Option[ConnectorId]`
- [x] 2.4 Replace every `ex.getMessage` in InlineSourceCleanup.scala with class + SQLSTATE via one helper; zero-hit grep probe recorded
- [x] 2.5 Existing specs (SourceCreatePostInsertCleanupSpec, InlineSourceLeakPathsRoutesSpec, PipelineProposalImplicitConnectorCleanupSpec, PatchSetUndoInlineSource*Spec, DataSourceDeleteAutoConnectorSpec) still pass; any test whose premise changed is named in red-evidence.md with why

## 3. Item 4 -- atomic connector + credential delete

- [x] 3.1 Red: fault-injection spec (credential `deleteAction` fails) asserting both rows survive
- [x] 3.2 Cross-tenant specs (i) and (ii) per design D7; each named mutation turns its case red
- [x] 3.3 Implement D3 in `ConnectorRepository.delete` (in-transaction locked re-read, credential id from the locked row)

## 4. Item 6 -- Connectors list refresh after undo

- [x] 4.1 Red: connectorsSlice test for undoPatchSet.fulfilled (removed → idle; kept-only → unchanged)
- [x] 4.2 Implement D4 (check for an import cycle)

## 5. Item 7 -- combined-wiring undo spec

- [x] 5.1 Spec per design D6 (plain, adopted connector, renamed source, shared connector)
- [x] 5.2 Named mutation evidence per design D7 (prefix → adopted, zero dependentCount → shared, renamed-source and plain mutations as specified)

## 6. Gates

- [x] 6.1 Targeted sbt specs green with `[hel1468-guard]`; frontend `npm test -- --testPathPatterns=connectorsSlice`, lint, typecheck, format:check
- [x] 6.2 Pre-commit hooks pass (no --no-verify); files-modified.md lists repo-relative backticked paths
