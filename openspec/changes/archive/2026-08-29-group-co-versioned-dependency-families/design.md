# Design — Group co-versioned dependency families in Dependabot

## Context

See `proposal.md` — Why. The relevant current state:

- `.github/dependabot.yml` has four update configs: npm `/`, npm `/frontend`, github-actions `/`, sbt `/backend`.
- github-actions and sbt already use `patterns: ["*"]` — every dependency in those two ecosystems is already in one group, so no family in `build.sbt` can be split. That is why the enumeration below is confined to npm.
- Both npm configs use `dev-dependencies: {dependency-type: "development"}`, which sweeps every devDependency into one PR. Dev families are therefore already grouped by construction.
- The residue — and the entire exposure — is **production dependencies in the two npm configs**.

## Goals / Non-Goals

Goals:
- Every co-versioned production family arrives in one PR.
- The grouping is enforced by a check that fails, not by a comment that asks.
- The enumeration is derived from the manifests and recorded, so the next family added to `package.json` has a stated place to land.

Non-Goals:
- Upgrading any dependency. No version in any manifest or lockfile changes.
- Resolving whether FontAwesome 7.3.1 is genuinely compatible. This change makes that question *askable*; the regenerated grouped PR answers it.
- HEL-874. See Decision 5.

## Decisions

### Decision 1: Which families to group — derived from the manifests

Enumerated by walking every production dependency in root `package.json` and `frontend/package.json`, and asking of each: *can a version mismatch between this and a sibling fail a gate that either passes alone?*

**frontend/package.json — production dependencies (18):**

Contracts below were checked against each package's real `peerDependencies`/`dependencies` in `frontend/node_modules`, not inferred from names. Evidence grade is stated per family, because the families are not equally well evidenced and pretending otherwise is how a weak grouping gets treated as a proven one.

| Family | Members | Binding contract (verified) | Evidence grade | Verdict |
| --- | --- | --- | --- | --- |
| `fortawesome` | `@fortawesome/fontawesome-svg-core`, `free-brands-svg-icons`, `free-solid-svg-icons`, `react-fontawesome` | `IconDefinition` / `IconProp` are declared in core and consumed by both the icon packages and the React binding. | **Proven** — live CI: #487/#485 fail the exact type error while #484/#482 pass. | **GROUP** |
| `echarts` | `echarts`, `echarts-for-react` | `echarts-for-react@3.0.6` declares `peerDependencies.echarts: "^3.0.0 \|\| ^4.0.0 \|\| ^5.0.0 \|\| ^6.0.0"` and re-exports echarts' option/instance types. The declared peer range spans four majors, so the coupling is real but loose — a *major* skew changes the option type surface; a minor skew generally will not. | Declared peer dependency. | **GROUP** |
| `redux` | `@reduxjs/toolkit`, `react-redux` | Not "released against each other" — measured, `@reduxjs/toolkit@2.11.2` declares `peerDependencies.react-redux: "^7.2.1 \|\| ^8.1.3 \|\| ^9.0.0"`, three majors wide. The real contract runs through `redux` itself: `react-redux@9.2.0` hard-peers `redux: "^5.0.0"`, while RTK vendors `redux` as a direct (bundled) dependency and is not a manifest entry. A `react-redux` major that moves its `redux` peer therefore requires RTK to move with it or the peer is unsatisfiable. The typed hooks are `react-redux`'s, not RTK's. | Declared peer dependency, transitively via `redux`. | **GROUP** |
| `markdown` | `react-markdown`, `remark-gfm` | Weaker than the others and labelled as such: `remark-gfm@4.0.1` declares **no** `peerDependencies`, and `react-markdown@10.1.0` does not depend on `remark-gfm`. The coupling is that `remark-gfm` is loaded through `react-markdown`'s `remarkPlugins` and both carry their own `unified` / `remark-parse` / `@types/mdast` deps, so a shared-major skew is a runtime plugin-interface failure. | **Inferred** — no declared peer link; never observed failing. Grouped because the cost is one combined PR and the failure mode is runtime rather than typecheck, i.e. one CI would not catch. | **GROUP** |
| react core | `react`, `react-dom`, `@types/react`, `@types/react-dom` | React and its DOM renderer are released in lockstep; the `@types` packages track the runtime major. | Already grouped by the existing `react` group. Note `react-redux@9.2.0` also hard-peers `@types/react: "^18.2.25 || ^19"`, a real second edge between the `redux` and `react` families; the ranges are wide enough that merging the two groups is not warranted, but the edge is recorded rather than left unnoted. | already grouped — but see Decision 2 |
| `react-grid-layout` | single | `react-grid-layout@2.2.3` declares peers `react >= 16.3.0` and `react-dom >= 16.3.0` only. Its `react-draggable` / `react-resizable` deps are transitive and are **not** manifest entries, so there is no sibling in `package.json` it can skew against. Its React peer range is wide enough that it does not need to move with the `react` group. | Declared peers checked. | **independent, justified** |
| `react-router-dom` | single | No sibling in the manifest; peers on `react`/`react-dom` only. | Declared peers checked. | independent |
| `axios` | single | Standalone HTTP client; shares no type surface with another manifest entry. | — | independent |
| `lucide-react` | single | Independent icon library; shares no types with `@fortawesome/*` despite the superficial similarity. | — | independent |
| `qrcode.react` | single | No sibling. | — | independent |
| `tslib` | single | TypeScript runtime helper, versioned against the `typescript` devDependency, which is in the already-grouped dev set. Coupling is loose (helpers are additive) and crossing the prod/dev boundary would drag the entire dev group into every `tslib` patch. | — | independent, justified |

That is 18 of 18 accounted for. `react-grid-layout` was missed in the first draft of this enumeration and caught at the design gate — while PR #481 bumping exactly that package was open. That near-miss is the direct reason for the coverage assertion in Decision 3: a hand-maintained table is not a control.

**root package.json — production dependencies (1):** `react-markdown`. Single entry in that config's manifest; the root config has no `remark-gfm` to pair it with. Independent *within its own update config*. Note that Dependabot groups do not span directories, so the frontend `markdown` group cannot cover this one.

**backend/build.sbt:** co-versioned families are real and numerous — pekko (`1.1.3`/`1.1.0` across 7 artifacts), jackson (`2.18.9` across 6), netty (`4.1.137.Final` across 9), flyway (`10.20.1` ×2), slick (`3.5.2` ×2), spark (`3.5.9` ×2). **All already covered** by the sbt config's `patterns: ["*"]`. No change needed; recorded here so the enumeration is complete rather than silently npm-only.

**github-actions:** `patterns: ["*"]`. Already covered.

Alternative considered: a single `frontend-production` group with `patterns: ["*"]` matching the sbt/actions approach. Rejected — it would bundle genuinely independent upgrades (`axios` with `echarts` with `react-router-dom`) into one PR, so a single unrelated breakage would block the whole batch and the auto-merge path would degrade to "review everything". Named families keep each PR's blast radius equal to its actual contract.

### Decision 2: Group ordering — specific before catch-all

Dependabot assigns a dependency to the **first** group whose criteria it matches, in declaration order. In the frontend config, `dev-dependencies` (`dependency-type: development`) is declared *before* `react` (`patterns: [react, react-dom, @types/react*]`). `@types/react` and `@types/react-dom` are devDependencies, so they match `dev-dependencies` first and are captured there — the `react` group only ever receives `react` and `react-dom`.

Honest statement of evidence: this is **not** confirmed by the current PR backlog. PR #479 ("react group … with 2 updates") contains exactly `react` and `react-dom`, and #478 (dev-dependencies) does not contain `@types/react*` — but neither `@types/react` package had an update available this cycle, so the backlog is consistent with both the defect and its absence. The conclusion rests on Dependabot's documented first-match semantics, not on measurement.

Response: declare pattern groups before the catch-all in both npm configs, and have the validator (Decision 3) encode first-match-wins and assert `@types/react*` resolves to `react`. That makes the ordering claim *testable* — the validator fails on the current ordering and passes on the fixed one — rather than leaving it as an assertion in a comment. If Dependabot's real behavior differs from its documentation, the ordering fix is harmless (the groups remain disjoint either way).

Pattern precision becomes newly load-bearing once specific groups are declared first: whichever pattern group is declared earliest now wins any overlap. Every family pattern is therefore an **exact package name**, with `@types/react*` as the sole wildcard. In particular the `react` group's pattern must remain `react` and never `react*`, which would otherwise swallow `react-dom`, `react-redux`, `react-markdown`, `react-router-dom` and `react-grid-layout` into the first-declared group. The validator's glob matcher anchors both ends and treats `*` as the only wildcard, so a sloppy matcher cannot make the check pass for the wrong reason.

Alternative considered: adding `exclude-patterns` to `dev-dependencies`. Rejected — it requires restating every pattern group's membership in a second place, which is exactly the drift this change exists to remove.

### Decision 3: The validator, and what makes it evidence

`scripts/check-dependabot-groups.mjs`. It must distinguish a grouped outcome from an ungrouped one, or it proves nothing. Design:

1. Read `.github/dependabot.yml`.
2. Read a declared-families table (embedded in the script, one entry per family from Decision 1: ecosystem, directory, member package names).
3. Read the manifest for each family's directory and assert every declared member is actually present. A family declared against a package that has been removed from `package.json` is a stale declaration and fails — this is what stops the table rotting into decoration.
4. Reimplement Dependabot's assignment: for each member, walk the update config's groups **in declaration order** and take the first match, where a group matches on `patterns` (glob) or on `dependency-type` (checked against the manifest's `dependencies`/`devDependencies` block).
5. Fail if a family's members do not all resolve to the same, non-null group.
6. **Coverage assertion.** Enumerate every entry in each configured directory's manifest `dependencies` block and fail unless each is either a member of a declared family or present on an explicit `declaredIndependent` allowlist embedded in the script (the independent rows of the Decision 1 table supply that list verbatim). This closes the failure mode that actually occurred during this change's own design gate: a production dependency present in the manifest and absent from the enumeration. Without it, the enumeration is documentation; with it, adding a package to `package.json` without ruling on its family fails the commit.

Failability is demonstrated two ways, both required:
- `scripts/check-dependabot-groups.selftest.mjs` runs the assignment logic against in-fixture configs: six cases, enumerated in tasks.md 2.6: ungrouped, split-across-two-groups, catch-all-declared-first, stale-declaration, and uncovered-manifest-package all expect fail; the fully grouped and correctly ordered one expects pass. Follows the existing `check-openspec-hygiene.selftest.mjs` convention.
- The executor must record a transcript of the validator run against the **pre-change** `.github/dependabot.yml` showing a non-zero exit naming `fortawesome`. A validator that has never been seen red is not evidence.

Alternative considered: a Jest test instead of a standalone script. Rejected — HEL-880 records that the jest gate is vacuous inside a worktree, so a green `npm test` there would not be evidence. A standalone script invoked directly is observable in both places.

### Decision 4: `open-pull-requests-limit`

The ticket asks whether 10 is still right. Measured: the limit is **per-ecosystem-per-directory**, not global, so "13 PRs against a limit of 10" is not the contradiction it appears to be. But the frontend npm config alone holds **exactly 10 open PRs against its own limit of 10** — it is saturated, and Dependabot is currently suppressing frontend updates it has already found.

Grouping recovers slots directly: the four FontAwesome PRs collapse to one (−3), and the redux pair collapses when both move (#488 `@reduxjs/toolkit` and #483 `react-redux` are both open right now, −1). That alone unsaturates it.

Raise the frontend npm limit to `15` anyway. Rationale: the frontend manifest has 18 production plus 16 dev entries, and a weekly cadence against a limit that the backlog has already hit once will hit it again. The limit exists to stop unbounded PR floods, and 15 with four families grouped is a lower *effective* flood than 10 ungrouped was. Leave the other three configs at 10 — none is near its limit (root npm 2, actions 1, sbt 1).

### Decision 5: HEL-874 is not folded in

HEL-874's premise is confirmed: ruleset `14964282` (`~DEFAULT_BRANCH`, active) requires the `ci-complete` status check, so `dependabot-auto-merge.yml`'s central design comment — "This repo has no branch protection / required status checks configured" — is now factually stale, and the elaborate `workflow_run` + head-SHA-re-verification machinery it justifies may be replaceable by native auto-merge.

Not folded in, for three reasons:

1. **Different kind of change.** This ticket changes how PRs are *formed*. HEL-874 changes how they are *merged*. Grouping is verifiable statically; retiring the merge workflow is only verifiable by letting a real Dependabot PR merge through the new path.
2. **Verification would consume this ticket's own subject matter.** The only way to prove native auto-merge now waits for `ci-complete` is to exercise it on a live Dependabot PR — the same backlog this ticket must leave in a *stated* condition. Doing both at once means neither result is cleanly attributable.
3. **Reviewability.** An acceptance criterion here is that version changes are reviewable on their own. Mixing in a rewrite of the auto-merge path makes the diff a mixture of "which PRs exist" and "which PRs merge themselves", which is the harder thing to review, not the easier.

The confirmed ruleset evidence will be posted to HEL-874 so it starts from a verified premise rather than re-deriving it. This is a deliberate leave-alone, not a half-measure: no part of `dependabot-auto-merge.yml` or `dependabot-metadata.yml` is touched.

### Decision 6: Demonstrating the grouping — real run, not inspection

The acceptance criterion distinguishes observing the effect from reading the cause. Both of the following are required; the second is not a substitute for the first if the first is achievable.

- **Config-validation equivalent (in-PR):** the validator plus its selftest, with a recorded red run against the pre-change config. This distinguishes grouped from ungrouped mechanically.
- **Actual Dependabot run (post-merge):** once the config is on `main`, comment `@dependabot recreate` on one of the four FontAwesome PRs. Dependabot re-reads `.github/dependabot.yml` from the default branch, and — with the family grouped — should close the individual PRs and open a single `Bump the fortawesome group in /frontend` PR. That PR's `frontend` result is the real answer about 7.3.1, and satisfies the second acceptance criterion.

- **Deterministic local probe (in-PR), for acceptance criterion 2 specifically:** the post-merge prong above depends on `@dependabot recreate` regrouping rather than merely rebasing, and its fallback is the next *weekly* scheduled run — so on its own it could leave "does 7.3.1 break us?" unanswered for a week after delivery. Independently of Dependabot, install all four `@fortawesome/*` packages at their matching target versions (core 7.3.1, free-solid 7.3.1, free-brands 7.3.1, react-fontawesome 3.5.0) with `--no-save --no-package-lock` so neither the manifest nor the lockfile is written, run `npm run typecheck`, then restore the tree with `npm --prefix frontend ci` (exact recipe in tasks.md 5.1-5.4), recording the transcript to the change's `evidence/` directory. This answers the question inside this ticket and on this ticket's schedule. The working copy is never committed and never pushed: the Non-Goal that no manifest or lockfile change ships is preserved, and task 3.4's `git diff --stat` assertion still holds. The real grouped PR then *confirms* this result rather than being its sole source.

Scope of what the probe closes: it answers the **type-contract** question, which is the one the observed failure is about. Acceptance criterion 2's wider "passes `frontend`" — which also covers lint, `format:check` and jest — remains closed by the real grouped PR. The probe is not claimed to substitute for that.

The coverage assertion in Decision 3 step 6 enumerates `dependencies` blocks only, not `devDependencies`. That is deliberate: every devDependency is already swept into one PR by the `dev-dependencies` catch-all, so no dev family can be split and there is nothing for a coverage assertion to catch there.

If the real Dependabot run cannot be triggered, that must be stated explicitly along with what was substituted — not quietly downgraded to inspection.

## Gate-Chain Implications Checklist

Required because `.husky/pre-commit` gains `npm run check:dependabot`.

- **What does it execute?** `node scripts/check-dependabot-groups.mjs`. Pure Node, no shell-out, no network, no package manager invocation, no git invocation.
- **What environment does it inherit, and from where?** The husky hook's environment, inherited from the invoking `git commit`. It reads no environment variables and depends on none — notably not `GIT_DIR`/`GIT_INDEX_FILE`, which is the HEL-657/HEL-805 poisoned-env mechanism; the script never invokes git, so that class of failure cannot reach it.
- **Does it write anything outside its own sandbox?** No. It is read-only: it opens `.github/dependabot.yml`, `package.json` and `frontend/package.json` and writes only to stdout/stderr. It creates no temp files. The selftest builds its fixtures in memory, not on disk.
- **Does it behave differently from a linked worktree than from a main checkout?** No. It resolves its inputs relative to the repository root it is invoked from and reads only tracked files that exist identically in a worktree. It does not depend on `node_modules` (it must parse YAML without a dependency — see task list), which matters because a linked worktree's `frontend/node_modules` is a symlink and the root's may be absent.
- **What happens on its first run?** It runs against the committed config and exits zero. There is no cache, no state file, no first-run bootstrap, and no created artifact — the first run and the thousandth are identical.

## Risks / Trade-offs

- **The validator's family table is hand-maintained and could rot** → step 3 of Decision 3 fails on any declared member missing from the manifest (a removed package breaks the build loudly), and step 6's coverage assertion fails on any manifest entry that is on neither the family table nor the `declaredIndependent` allowlist (a newly added package breaks the build loudly). Both directions are now mechanically detected. This risk was originally accepted as unmitigated, and it materialised immediately — `react-grid-layout` was missed — which is why it is now enforced rather than documented. The residual gap is narrow: a package correctly listed as independent that *later* acquires a sibling it should be grouped with is still a human judgement.
- **Grouping enlarges each PR's blast radius: one bad member blocks its whole family** → this is the intended trade. An unbuildable combination is worse than a blocked one, and the family boundary is drawn at the actual contract, so members that can fail independently are not grouped together.
- **The grouped FontAwesome PR may still fail at matching versions** → that is a legitimate outcome, not a failure of this change. It would mean 7.3.1 is genuinely breaking for us, which is the answer the ticket asks for. It gets reported, not fixed here.
- **Dependabot's first-match ordering may not match its documentation** → the ordering fix is behaviour-neutral if so (Decision 2), and the validator's assertion is about our config's intent either way.
- **`@dependabot recreate` may not regroup, only rebase** → if the individual PRs do not collapse, the fallback is to close them and wait for the next scheduled run, stated explicitly rather than glossed.

## Migration Plan

No runtime component, no data, no rollback complexity. Reverting the commit restores the previous configuration; already-open PRs are unaffected by the revert.

Ordering matters for the backlog: merge the config first, then act on the Dependabot backlog, so the regenerated PRs are produced under the new grouping.
