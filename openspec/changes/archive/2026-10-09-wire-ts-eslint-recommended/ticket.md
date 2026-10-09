# HEL-1448: ESLint: no @typescript-eslint recommended rules are active (`...tseslint.configs.recommended.rules` spreads undefined)

## Description

Origin: HEL-1399's lane. The driver confirmed it on main fd99c3dd.

`eslint.config.cjs` (repo root, L76) spreads `...tseslint.configs.recommended.rules` into the TS file block. In the installed `typescript-eslint`, `configs.recommended` is an ARRAY of flat-config objects, so `.rules` is `undefined` and the spread adds nothing. Only rules listed explicitly elsewhere in the block are active; the whole `@typescript-eslint/recommended` set (no-unused-vars, no-explicit-any, ban-ts-comment, ...) is silently off. "Zero-warnings" lint has not been checking those.

## Acceptance Criteria

- Prove it red first: a file with an unused import or var and an explicit `any` lints clean on main.
- Wire the recommended set correctly for the flat config (spread `tseslint.configs.recommended` entries scoped to TS files, or merge their `.rules`), keeping the existing explicit overrides.
- Turning the rules on will surface a backlog of violations. Measure the count first. If it's large, the scope choice (fix all now / fix with per-rule exemptions + follow-ups / warn-only temporarily) is an owner call; escalate with the counts per rule. The zero-warnings policy must hold at the end of the chosen path.
- A guard test that fails if the TS rule set ever comes back empty again (e.g. assert a known recommended rule is active in the computed config).

## Driver context

- Autofix allowed for mechanical rules; every non-mechanical change (e.g. replacing `any`) is real code: typecheck + full jest must stay green, type-only changes must not alter runtime behaviour.
- Pre-commit runs `npm run lint --max-warnings=0`: config change and fixes land together.
