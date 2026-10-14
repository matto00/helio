## MODIFIED Requirements

### Requirement: Guard fails when the TypeScript recommended set is inactive

A guard run in both the pre-commit hook and CI SHALL fail when the computed lint configuration for a representative TS file in each linted package — including a representative test-file path for every linted package (jest `*.test.ts`/`*.test.tsx` files in frontend/ and helio-mcp/, and an e2e Playwright spec) — has a required typescript-eslint recommended rule inactive. For each test-file path, every typescript-eslint rule active as an error on the corresponding non-test path of the same package SHALL also be active as an error, except for an exact, named (path, rule) allowance that mirrors an intentional, documented config exemption. Its self-test SHALL demonstrate the failure against the previously broken configuration shape and against a configuration whose test-file override turns a required rule off.

#### Scenario: Broken spread is caught
- **WHEN** the lint config spreads `configs.recommended.rules` (undefined) instead of the recommended entries
- **THEN** the guard exits non-zero naming the missing rule(s)

#### Scenario: Test-file override disabling a required rule is caught
- **WHEN** the lint config is otherwise correct but an override scoped to test files turns off any typescript-eslint rule that is active on the corresponding non-test path and is not in the named allowance (including rules beyond the representative required set)
- **THEN** the guard exits non-zero naming the test path and the rule

#### Scenario: Documented jest require() exemption is allowed
- **WHEN** the only rule off for jest test files is the documented `@typescript-eslint/no-require-imports` exemption
- **THEN** the guard does not report it

#### Scenario: Correct wiring passes
- **WHEN** the recommended set is wired correctly
- **THEN** the guard exits zero
