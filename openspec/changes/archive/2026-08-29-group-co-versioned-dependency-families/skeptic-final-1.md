## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Diff scope used: `git diff 6352b1a2..HEAD` (merge base, per orchestrator note). 20 files,
+1678/-3. Nothing outside `.github/dependabot.yml`, `.github/workflows/ci.yml`,
`.husky/pre-commit`, root `package.json`, `scripts/check-dependabot-groups*.mjs`, and the
openspec change dir. No application code, no UI, no DB — dev servers correctly not started.

### What I verified (with evidence)

**AC1 — is the validator a config-validation equivalent, or inspection in a test's clothes?**

It is a genuine equivalent. `scripts/check-dependabot-groups.mjs` does not read the YAML for
shape; it reimplements Dependabot's documented first-match-wins group assignment
(`assignGroup`, walking `Object.entries(groups)` in declaration order, matching on `patterns`
via a both-ends-anchored glob or on `dependency-type` resolved against the real manifest) and
asserts each declared family resolves to exactly one non-null group. That computation has a
grouped outcome and an ungrouped outcome and returns different answers for them.

I re-derived failability myself by mutating a scratch copy at
`/tmp/.../scratchpad/mut` (not the worktree) and running the checker against it:

| Mutation | Result |
| --- | --- |
| M1 delete the `fortawesome` group | FAILED exit=1 — `family "fortawesome" is split/ungrouped: ... resolve to no group` |
| M2 move `dev-dependencies` catch-all back above the pattern groups | FAILED exit=1 — `family "react" is split across 2 groups (react, dev-dependencies): react -> react, react-dom -> react, @types/react -> dev-dependencies, @types/react-dom -> dev-dependencies` |
| M4 split the icon packages into a second `fa-icons` group | FAILED exit=1 — `family "fortawesome" is split across 2 groups (fortawesome, fa-icons)` + full per-member assignment |
| M3 add an uncovered prod dep `some-new-lib` to `frontend/package.json` | FAILED exit=1 — `unaccounted production dependency "some-new-lib"` |
| unmodified config | OK exit=0 |

M2 is the load-bearing one: it independently confirms Decision 2's ordering claim is *asserted*
by the check, not merely asked for in the new YAML comment. The in-PR red transcript
(`evidence/validator-red-precommit.txt`, 5 problems at merge base 6352b1a2) is consistent with
what I reproduced from the other direction.

I also tried to make it pass for a wrong reason:
- Corrupted/unparsable config → fails closed (`could not parse ...`), families then error out.
- Stale family member removed from the manifest → selftest case (d), verified red under mutation.
- Loose matcher: `matchesPattern` anchors `^...$` and escapes regex metacharacters, so
  `react` does not match `react-dom`/`react-redux`. Confirmed by M2/M4 producing correct
  per-member assignments rather than blanket matches.
- The one wrong-reason pass I did find is noted below (mega-group), and is out of the
  invariant's stated scope rather than a hole in it.

Selftest is itself failable, not decorative — it asserts on failure *reason text*. Mutating the
checker to disable split detection (`if (groupNames.length > 1)` → `if (false)`) turns cases (b)
and (c) red with named expectations; disabling the coverage assertion turns case (e) red. Real
exit code of the mutated selftest is **1**, clean is **0** (verified without a pipe, so this is
not a `PIPESTATUS` artifact). Both scripts are wired into `.husky/pre-commit` and `ci.yml`, and
`npm run check:dependabot` / `check:dependabot:selftest` both exit 0 on HEAD.

**AC2 — the FontAwesome answer.** I did not take the transcript on trust; I re-ran both
directions in this worktree.

- Matched versions (core 7.3.1, free-solid 7.3.1, free-brands 7.3.1, react-fontawesome 3.5.0,
  `npm ls` confirming the tree, core deduped under react-fontawesome): `tsc --noEmit` **exit 0**.
  Reproduces `evidence/fontawesome-matching-versions-typecheck.txt`.
- Mismatched versions (core pinned 7.2.0 + react-fontawesome 3.3.1, icons 7.3.1): typecheck
  **fails** with exactly the ticket's `TS2322: Type 'IconDefinition' is not assignable to type
  'IconProp'`, root-caused in the output to two distinct copies of
  `@fortawesome/fontawesome-common-types` (`"fasldr"` not assignable to the old `IconPrefix`).

That pair is the discriminating evidence the user demanded: it distinguishes the grouped outcome
from the ungrouped one. 7.3.1 is not breaking; the ungrouped split was the defect. Worktree
restored afterwards via `npm --prefix frontend ci` — node_modules back at 7.2.0/3.3.1, typecheck
green, `git status` clean apart from the untracked `evaluation-1.md`.

Correctly scoped caveat, as flagged: the transcript covers `typecheck` only, not the whole
`frontend` CI job (lint / format:check / jest / e2e). That is the right scope for the type error
in question, and the whole-job answer is explicitly deferred to task 7.2 post-merge.

**AC3 — the enumeration (weighted highest).** `frontend/package.json` has exactly 18 production
dependencies. I enumerated them myself and mapped each:

- Families (12): fortawesome ×4, echarts ×2, redux ×2, markdown ×2, react ×2 (`react`,
  `react-dom`; `@types/react`/`@types/react-dom` are the dev members).
- `DECLARED_INDEPENDENT` (6): `react-grid-layout`, `react-router-dom`, `axios`, `lucide-react`,
  `qrcode.react`, `tslib`. Plus root `/` → `react-markdown`.

12 + 6 = 18. No gaps, and the script's coverage assertion enforces it (M3 above proves it bites).
The allowlist matches design.md Decision 1's independent rows verbatim, including the correct
observation that Dependabot groups do not span directories so the frontend `markdown` group
cannot cover the root `react-markdown`.

I checked the contract claims against real metadata in `frontend/node_modules`, since an earlier
design round found a factually wrong one. Every claim holds:

- `echarts-for-react@3.0.6` peer `echarts: ^3||^4||^5||^6` — as stated (loose but real).
- `@reduxjs/toolkit@2.11.2` peer `react-redux: ^7.2.1||^8.1.3||^9.0.0`; `react-redux@9.2.0` hard
  peers `redux: ^5.0.0` and RTK vendors `redux` as a direct dep — exactly the corrected reasoning
  in Decision 1, not the naive "released together" claim.
- `remark-gfm@4.0.1` declares **no** peerDependencies and `react-markdown@10.1.0` does not depend
  on it — the design labels this family *Inferred*, honestly, rather than overclaiming.
- `react-grid-layout@2.2.3` peers only `react`/`react-dom`; `react-draggable`/`react-resizable`
  are transitive, not manifest entries — independence justified, not waved through.
- `react-router-dom@7.18.2` (dep `react-router`, transitive), `axios@1.19.0`, `lucide-react@1.14.0`,
  `qrcode.react@4.2.0`, `tslib@2.8.1` — none has a manifest sibling. Independence stands.

No genuinely co-versioned family is on the allowlist. The backend/`build.sbt` and
github-actions families are already covered by their `patterns: ["*"]` groups; I confirmed both
configs still carry that.

**AC4 — no production dependency upgraded as a side effect.** `git diff 6352b1a2..HEAD --stat`
over `frontend/package.json`, `package-lock.json`, `frontend/package-lock.json`, `build.sbt`,
`backend/build.sbt` is **empty**. The only root `package.json` change is the two `check:dependabot*`
script entries. Zero version movement.

**AC5** — post-merge orchestrator work (tasks 7.1–7.4), correctly out of this diff. Not failed.

**`open-pull-requests-limit: 15`** — justified by measurement, not preference. The ticket's
verified premise notes record frontend npm at exactly 10 open PRs against a limit of 10, i.e.
saturated and silently suppressing updates; the other three configs are nowhere near theirs and
stay at 10. With four families collapsed, 15 is strictly less flood than the 10 ungrouped it
replaces. The reasoning is in the config comment where the next reader will find it.

**Group ordering change** — correct and safe. Pattern groups now precede the `dev-dependencies`
catch-all in the frontend config; M2 shows the old ordering is now a hard failure. The root npm
config has only the catch-all and no pattern group, so ordering is moot there — the design's
"both npm configs" phrasing is vacuously satisfied, not skipped. Even if Dependabot's real
behavior differed from its documented first-match semantics, disjoint groups make the reorder
harmless.

I did not credit `npm test` as evidence anywhere, per instruction. I did not touch anything in
the out-of-scope list, and did not run `concertino sync` or `cleanup.sh`.

### Verdict: CONFIRM

The claim that survived my strongest attack is the one the user asked to be true: the grouping is
enforced by a computation that returns a different answer for a grouped config than for an
ungrouped one, and I produced both answers myself from mutations rather than reading either the
YAML or the executor's narrative.

### Non-blocking notes

- **The validator's invariant is non-splitting, not granularity.** Replacing the whole frontend
  `groups:` block with a single `everything: patterns: ["*"]` mega-group **passes** the check
  (I tried it). That is not a hole — a mega-group genuinely does deliver every family in one PR,
  which is the asserted property — but it means the check does not defend the "named families,
  blast radius = actual contract" choice that design.md Decision 1 explicitly makes over the
  `patterns: ["*"]` alternative. If that choice is worth defending mechanically, a future
  assertion could be "no group contains a package outside its declared family". Not worth
  blocking on now.
- `echarts@6.1.0` carries `tslib` as a direct dependency, so `tslib` has a (transitive) edge to a
  manifest sibling. Decision 1 justifies `tslib`'s independence solely against the `typescript`
  devDependency and does not mention this. It does not change the verdict — tslib helpers are
  additive and the echarts edge resolves transitively regardless — but the row's justification is
  narrower than the real graph.
- AC2's transcript is `typecheck`-scoped; the full `frontend`-job answer at matching versions is
  owed by task 7.2 and should not be reported as already delivered.
- `openspec/changes/group-co-versioned-dependency-families/evaluation-1.md` is untracked at HEAD.
