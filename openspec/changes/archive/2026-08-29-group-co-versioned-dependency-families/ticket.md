# HEL-898: Dependabot splits package families that must upgrade together — 4 FontAwesome PRs each fail against the others' old versions

## Description

Dependabot opened 13 PRs. Four bump `@fortawesome/*` packages individually. The two icon packages fail `frontend` CI with a real type error:

```
src/app/CommandBar.tsx(220,38): error TS2322:
  Type 'IconDefinition' is not assignable to type 'IconProp'.
```

| PR | Package | Result (verified live 2026-08-30) |
| -- | -- | -- |
| #484 | `@fortawesome/fontawesome-svg-core` 7.2.0→7.3.1 | CLEAN |
| #482 | `@fortawesome/react-fontawesome` 3.3.1→3.5.0 | CLEAN |
| #487 | `@fortawesome/free-solid-svg-icons` 7.2.0→7.3.1 | FAILS `frontend` |
| #485 | `@fortawesome/free-brands-svg-icons` 7.2.0→7.3.1 | FAILS `frontend` |

All four share a type contract. `free-solid-svg-icons@7.3.1` compiled against `fontawesome-svg-core@7.2.0` is the incompatibility — not a defect in 7.3.1. Nothing has ever tested the four at matching versions, so CI is answering a question nobody asked.

Root cause: `.github/dependabot.yml` defines groups for `dev-dependencies`, `react`, `github-actions` and `sbt` — but no group for `@fortawesome/*`. HEL-456 shipped the grouped-PR config and this family was missed.

A CI signal that is routinely wrong for structural reasons stops being read, which is how a real breaking change gets merged.

## Acceptance criteria

- [ ] `@fortawesome/*` upgrades arrive as a single grouped PR, demonstrated by an actual Dependabot run or a config-validation equivalent, not by reading the YAML.
- [ ] The grouped FontAwesome upgrade either passes `frontend` at matching versions, or fails with a genuine incompatibility that is then reported — state which, with the CI evidence.
- [ ] The enumeration of other ungrouped co-versioned families is recorded, with each either grouped or explicitly justified as independent. Derived from `package.json`/`build.sbt`, not intuited.
- [ ] No production dependency is upgraded as a side effect of this ticket beyond what the grouping causes; version changes are reviewable on their own.
- [ ] The current open Dependabot backlog is left in a stated condition — merged, closed as superseded, or deliberately pending — rather than silently abandoned.
- [ ] State whether `open-pull-requests-limit: 10` is still right.

## Explicitly out of scope

The `hel813` e2e flake (HEL-897) also fails several of these PRs. Unrelated. Do not touch `e2e/hel813-mobile-touch-target-floor.spec.ts` or its support files.

## Adjacent

HEL-874 covers `dependabot-auto-merge.yml` now that `main` requires CI. Fold in only if one PR covers both coherently; otherwise leave it and say why. Do not half-do it.

## Verified premise notes (from Setup premise validation)

- The #484/#482 CLEAN vs #487/#485 FAIL asymmetry is confirmed by direct measurement.
- e2e PASSES on #487 and #485 — the HEL-897 flake is not a factor on those two; `frontend` typecheck is the sole failure.
- `open-pull-requests-limit` is per-ecosystem-per-directory. 13 total is not over limit, but frontend npm alone holds exactly 10 open PRs against its own limit of 10 — saturated, actively suppressing further frontend updates.
- Ruleset 14964282 (~DEFAULT_BRANCH, active) requires the `ci-complete` status check, so HEL-874's premise holds: `dependabot-auto-merge.yml`'s central design comment is now factually stale.
