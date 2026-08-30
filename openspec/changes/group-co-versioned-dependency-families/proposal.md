# Group co-versioned dependency families in Dependabot

## Why

`.github/dependabot.yml` groups `dev-dependencies`, `react`, `github-actions` and `sbt`, but leaves every other production dependency ungrouped — one PR per package. When a package family shares a compile-time or runtime contract, that split produces PRs that are individually unbuildable: each one raises its own member against the others' old versions.

This is not hypothetical. Measured live on 2026-08-30: `@fortawesome/fontawesome-svg-core` (#484) and `@fortawesome/react-fontawesome` (#482) are fully green, while `@fortawesome/free-solid-svg-icons` (#487) and `@fortawesome/free-brands-svg-icons` (#485) fail the `frontend` gate with ~20 `TS2322: Type 'IconDefinition' is not assignable to type 'IconProp'` errors. `e2e` passes on both failing PRs, so this is not the HEL-897 flake — the typecheck is the sole failure. The asymmetry is the diagnosis: the icon packages at 7.3.1 are being typechecked against core at 7.2.0, a combination that will never be shipped.

The cost is not the triage cycle. It is that a `frontend` gate which is red for structural reasons stops being read, and a real breaking change eventually rides in behind the noise.

## What Changes

- Add `.github/dependabot.yml` groups for the co-versioned production families derived from the manifests: `fortawesome`, `echarts`, `redux`, and `markdown` (frontend npm), so each family moves as one PR.
- Reorder each update config's groups so specific pattern groups precede the catch-all `dev-dependencies` group. Dependabot assigns a dependency to the **first** matching group; with `dev-dependencies` listed first, any devDependency that a pattern group also names (notably `@types/react*` in the `react` group) is silently captured by the catch-all instead. This is a latent correctness defect in the existing config, not a stylistic change.
- Add `scripts/check-dependabot-groups.mjs`: a failable validator that reads the real manifests and the real `.github/dependabot.yml`, applies Dependabot's documented first-match-wins group-assignment semantics, and asserts that every declared co-versioned family resolves to exactly one group. It fails on the current config. Wire it into the pre-commit hook and the CI `frontend` job as `check:dependabot`.
- Add `scripts/check-dependabot-groups.selftest.mjs`, following the existing `check-openspec-hygiene.selftest.mjs` convention, proving the validator rejects an ungrouped-family config and accepts a grouped one — so the validator's own pass is evidence rather than assertion.
- Record the full manifest enumeration, with each family either grouped or explicitly justified as independent, in `design.md`.
- Raise `open-pull-requests-limit` for the frontend npm config, which is measurably saturated at exactly 10 open PRs against its limit of 10.

No dependency version is changed by this ticket. `package.json`, `package-lock.json` and `build.sbt` are untouched.

## Capabilities

### New Capabilities
- `dependabot-update-grouping`: the contract that co-versioned dependency families arrive as a single Dependabot PR, and that the contract is mechanically enforced rather than maintained by convention.

### Modified Capabilities

(none)

## Impact

- `.github/dependabot.yml` — new groups, group ordering, PR limit.
- `.github/workflows/ci.yml` — `frontend` job runs `check:dependabot`.
- `.husky/pre-commit` — runs `check:dependabot`. This is a commit-gate-chain change; see the Gate-Chain Implications Checklist in `design.md`.
- `package.json` — new `check:dependabot` script entry (scripts block only; no dependency changes).
- `scripts/check-dependabot-groups.mjs`, `scripts/check-dependabot-groups.selftest.mjs` — new.
- No application code. No database. No production dependency versions.
