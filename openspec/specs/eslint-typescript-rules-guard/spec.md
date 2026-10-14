# eslint-typescript-rules-guard Specification

## Purpose
Ensure TypeScript lint actually enforces the typescript-eslint recommended rule set, and that a config regression silently disabling it is caught mechanically.

## Requirements

### Requirement: TypeScript files are linted with the typescript-eslint recommended set

Repository lint SHALL apply the typescript-eslint recommended rules as errors to every linted `.ts`/`.tsx` file in frontend/, helio-mcp/ and e2e/, and repository lint SHALL report zero errors and zero warnings.

#### Scenario: Unused import is rejected
- **WHEN** a linted `.ts` or `.tsx` file contains an unused import or an unused non-`_`-prefixed variable
- **THEN** lint reports a `@typescript-eslint/no-unused-vars` error

#### Scenario: Explicit any is rejected
- **WHEN** a linted TS file annotates a value with an explicit `any`
- **THEN** lint reports a `@typescript-eslint/no-explicit-any` error

#### Scenario: Intentional underscore-prefixed bindings are allowed
- **WHEN** an argument, variable or caught error is prefixed with `_`, or is a rest-sibling of a destructure used to omit keys
- **THEN** lint does not report it as unused

#### Scenario: require() is allowed only in jest test and setup files
- **WHEN** a jest test file or jest setup file uses `require()`
- **THEN** lint does not report `@typescript-eslint/no-require-imports`
- **WHEN** a non-test TS source file uses `require()`
- **THEN** lint reports `@typescript-eslint/no-require-imports`

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
