## ADDED Requirements

### Requirement: The hygiene guard and its self-test are enforced in continuous integration

The `check-openspec-hygiene` gate AND its self-test SHALL both run as merge-blocking continuous-integration steps,
in addition to the pre-commit chain. A pre-commit hook alone SHALL NOT be treated as sufficient enforcement,
because the hook chain is bypassable and does not run on changes that reach the default branch by another route.

Neither may be wired without the other: a self-test exists to certify that its gate is capable of failing, so
running the self-test in continuous integration while the gate itself never runs there would certify an
unenforced gate.

Because both shell out to the `openspec` command-line interface, which is not a repository dependency, the
continuous-integration environment SHALL install that interface before running either check. The installed
version SHALL be derived from the single declaration the repository already uses to detect version drift, rather
than independently restated, so the installed and expected versions cannot silently diverge.

#### Scenario: Both the gate and its self-test run on every pull request

- **WHEN** continuous integration runs on a pull request
- **THEN** it runs both the hygiene gate and the hygiene gate's self-test, so a guard silently degraded into
  checking nothing is caught by a run that cannot be bypassed

#### Scenario: A bypassed hook does not evade the gate

- **WHEN** a change that breaks the hygiene guard's own checks is committed with the pre-commit hook bypassed and
  pushed as a pull request
- **THEN** the continuous-integration run fails, blocking the merge

#### Scenario: The command-line interface is present at the expected version

- **WHEN** the continuous-integration environment prepares to run the openspec checks
- **THEN** it installs the openspec command-line interface at the version taken from the repository's single
  version declaration, so the checks neither fail for a missing interface nor run against an unexpected one
