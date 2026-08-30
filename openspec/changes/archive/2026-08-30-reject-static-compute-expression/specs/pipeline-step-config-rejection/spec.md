## ADDED Requirements

### Requirement: A `compute` expression that cannot be parsed is rejected on the write path

A `compute` step configuration whose `expression` is non-empty but cannot be parsed under either the
strict `$`-prefixed grammar or the frozen legacy bare-identifier grammar SHALL be rejected with a 422
whose message carries the parser's own description of the problem, not a generic one. The rejection
SHALL apply at every write surface that validates step configuration — step create, step update,
pipeline-proposal apply, and patch-set apply — via the step kind's `validateRawConfig`, so no write
surface can accept what another rejects.

The predicate SHALL be parseability under the same grammar the run path uses to evaluate the
expression, so that exactly those expressions which could never produce a value for any row are
rejected. An expression that fails the strict grammar but parses under the legacy grammar SHALL be
accepted, because it still evaluates correctly at run time and existing pipelines depend on it.

An `expression` that is missing, empty, or whitespace-only SHALL NOT be rejected on the write path. An
unconfigured draft must remain saveable so a compute step can be added and configured later; that case
is governed by `pipeline-step-config-runtime-completeness` instead.

Expression validation SHALL NOT be performed on the read path. Loading a stored step whose expression
is unparseable SHALL return the step, because a read-path failure surfaces as an error backing every
read and would make the pipeline editor unopenable for exactly the steps a user needs to open to
repair them.

#### Scenario: Unparseable expression is rejected at step create
- **WHEN** a `compute` step is created with `{"column":"value_vs_adp","expression":"stats.adp_ppr - stats.pts_ppr"}`
- **THEN** the request is rejected with 422 and the message contains the parser's description of the problem

#### Scenario: Unparseable expression is rejected at step update
- **WHEN** an existing valid `compute` step is updated to an expression that parses under neither grammar
- **THEN** the request is rejected with 422 and the stored configuration is unchanged

#### Scenario: Empty expression remains saveable
- **WHEN** a `compute` step is created with `{"column":"","expression":""}`
- **THEN** the request succeeds and the step is stored

#### Scenario: A legacy bare-identifier expression remains acceptable
- **WHEN** a `compute` step is created with an expression that fails the strict grammar but parses under
  the legacy bare-identifier grammar
- **THEN** the request succeeds, because the expression still evaluates at run time

#### Scenario: A stored unparseable step still loads
- **WHEN** a `compute` step whose stored expression is unparseable is read back
- **THEN** the read succeeds and returns the step
