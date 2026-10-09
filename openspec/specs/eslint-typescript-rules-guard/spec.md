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

A guard run in both the pre-commit hook and CI SHALL fail when the computed lint configuration for a representative TS file in each linted package has no active typescript-eslint recommended rule, and its self-test SHALL demonstrate the failure against the previously broken configuration shape.

#### Scenario: Broken spread is caught
- **WHEN** the lint config spreads `configs.recommended.rules` (undefined) instead of the recommended entries
- **THEN** the guard exits non-zero naming the missing rule(s)

#### Scenario: Correct wiring passes
- **WHEN** the recommended set is wired correctly
- **THEN** the guard exits zero
