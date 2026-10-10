## Context

See proposal.md - Why. Root `eslint.config.cjs` is the only ESLint config (frontend's `eslint src`, helio-mcp, e2e all resolve to it). `tseslint.configs.recommended` = 3 entries: [0] base (parser + plugin, NO `files`), [1] eslint-recommended (core-rule offs, `files` ts/tsx/mts/cts), [2] recommended (rules, NO `files`). Spreading entries unscoped would apply TS rules to `.js/.cjs/.mjs` files too. Baseline evidence: `.concertino/runs/HEL-1448/evidence/openspec/changes/wire-ts-eslint-recommended/lint-baseline.json` (105 errors / 67 files, computed with entries scoped to `**/*.{ts,tsx}` inserted before the existing TS block).

Owner ruling: fix-all-now-with-conventions (escalation.answered, chat, 2026-10-09).

## Goals / Non-Goals

**Goals:** recommended set active for all TS; zero errors/warnings repo-wide; guard proven red-first; every dead-import removal a true no-op; every `any` replacement type-only.

**Non-Goals:** enabling `recommended-type-checked`/`strict` sets; refactoring dead *functions* beyond removing what lint flags (if removing an unused binding leaves an otherwise-unreferenced helper, delete only that helper, nothing wider); changing jest mocking style (`require` in `jest.mock` stays).

## Decisions

**D1 – Wiring.** `...tseslint.configs.recommended.map((c) => ({ ...c, files: ["**/*.{ts,tsx}"] }))` inserted immediately before the existing TS block; remove the broken `...tseslint.configs.recommended.rules` spread. The existing TS block keeps parser/globals/plugin and `"no-unused-vars": "off"`. Alternative (merge `.rules` via `Object.assign` of every entry) rejected: loses the scoping semantics of entry [1] and is the same "hand-flatten an array" shape that broke.

**D2 – no-unused-vars options.** In the TS block: `"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true }]`. Clears the 22 deliberate `_` cases (measured). A *non*-`_` unused binding is fixed by removal, never by renaming to `_x` to silence it — except an unused positional *parameter* required by a callback signature, where `_` prefix is the correct idiom.

**D3 – no-require-imports scope.** A trailing block `{ files: ["**/*.test.{ts,tsx}", "frontend/src/test/**/*.{ts,tsx}"], rules: { "@typescript-eslint/no-require-imports": "off" } }`. Production TS keeps the rule (currently 0 hits there). `*.spec.ts` (Playwright e2e, not jest) is deliberately NOT exempted (design-gate skeptic note 1, C3).

**D4 – Dead imports are a true no-op.** For each removed import, confirm the module is not imported for side effects (CSS, polyfills, registration, `jest.mock` hoisting dependencies). If it is, keep it as a bare `import "mod"` and record it in files-modified.md/PR. Removing an unused import that is the target of a `jest.mock("…")` call in the same file is fine (jest.mock does not need an import), but verify the test still passes.

**D5 – any replacements.** Each `any` gets the narrowest real type available (`unknown` + narrowing, a library type, or a local interface). Type-only; no runtime expression changes. e2e `any`s (page.evaluate / window casts) may use `unknown`/typed window augmentation. Verified by `npm run typecheck`, `check:e2e-types`, `check:helio-mcp-types`, full jest.

**D6 – Guard.** `scripts/check-eslint-ts-rules.mjs`: uses the ESLint Node API (`new ESLint({ cwd: repoRoot, overrideConfigFile?})`, `calculateConfigForFile`) for one representative `.ts` and `.tsx` path in each of frontend/src, helio-mcp/src, e2e; asserts a fixed set of recommended rules (`no-unused-vars`, `no-explicit-any`, `ban-ts-comment`, `no-require-imports` for non-test paths) are severity 2, AND `lintText` of a probe snippet (unused import + `any`) reports both rule ids. Accepts an optional config-path argument so the selftest can point it at a fixture config. `scripts/check-eslint-ts-rules.selftest.mjs`: (a) real config → exit 0; (b) fixture config reproducing the old `...configs.recommended.rules` spread → exit non-zero, asserting the named missing rule appears in output. Fixtures under `mkdtemp` (repo convention) — if ESLint base-path rules require the fixture config to sit in the repo, use a gitignored/cleaned temp path and document it. Wired as `check:eslint-ts-rules` + `:selftest` in package.json, `.husky/pre-commit` and a `ci-complete`-gated job in `.github/workflows/ci.yml` (check-precommit-ci-parity requires both).

**D7 – One commit for config + fixes** (pre-commit hook runs `npm run lint --max-warnings=0`).

## Risks / Trade-offs

- Removing an import with a hidden side effect changes behaviour → D4 audit + full jest + e2e type check.
- Concurrent open branches (HEL-1430 et al.) will fail lint after merge → called out in PR body.
- Guard via ESLint API could drift with ESLint major versions → selftest re-proves on every run.

## Gate-Chain Implications Checklist

- **What does it execute?** `node scripts/check-eslint-ts-rules.mjs` (ESLint Node API: `calculateConfigForFile` for five representative TS paths plus one `lintText` probe) and `node scripts/check-eslint-ts-rules.selftest.mjs` (spawns the guard against the real config and a broken-spread fixture). Both are read-only against the repo.
- **What environment does it inherit, and from where?** Git hook environment (possibly `GIT_DIR`/`GIT_INDEX_FILE` from a linked worktree) plus the npm-run PATH. Neither script invokes git or reads those variables; the repo root is derived from `import.meta.url`, and `eslint` is resolved via `createRequire(<repoRoot>/package.json)`, so the cwd of the hook does not matter.
- **Does it write anything outside its own sandbox?** No writes to the repo. The selftest creates one `mkdtemp` directory under `os.tmpdir()` for the fixture config and removes it in a `finally`; ESLint is run without `--cache`.
- **Does it behave differently from a linked worktree than from a main checkout?** No: all paths are resolved from the script location, and ESLint's `cwd` is pinned to that root. `.claude/worktrees/**` is ignored by the config, so a nested worktree is not walked. Verified via test-gate-in-isolation.sh (PASS for both scripts) and by running the hook from this linked worktree.
- **What happens on its first run?** There is no state or cache to initialise: it computes config and exits 0 (green on the real config) or 1 with the missing rule names on stderr. The first run on this branch passed; the mutation proof (task 4.4) showed it exits 1 when the broken spread is restored.
