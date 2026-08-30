# Skeptic Report — design gate (round 2, skeptic-design-2.md)

## What I verified (with evidence)

### The five round-1 change requests, each against ground truth

**CR1 — `react-grid-layout` missing / count wrong. ADDRESSED.**
`node -e` over `frontend/package.json` → exactly **18** production dependencies,
matching design.md line 30. Every one of the 18 now appears in the Decision 1 table:
fortawesome ×4, `@reduxjs/toolkit`, `axios`, `echarts`, `echarts-for-react`,
`lucide-react`, `qrcode.react`, `react`, `react-dom`, `react-grid-layout`,
`react-markdown`, `react-redux`, `react-router-dom`, `remark-gfm`, `tslib`.
Line 41's `react-grid-layout` row and its "independent, justified" verdict match the
installed metadata (`react-grid-layout@2.2.3` peers: `react >= 16.3.0`,
`react-dom >= 16.3.0`; `react-draggable`/`react-resizable` are its own deps, not
manifest entries). Line 48's near-miss note is honest, not defensive. *But see
Required Revision 2 — a stale copy of the old count survives at line 93.*

**CR2 — `redux` contract factually wrong. ADDRESSED, and now correct.**
Read from `frontend/node_modules`:
`@reduxjs/toolkit@2.11.2` peers `react-redux: "^7.2.1 || ^8.1.3 || ^9.0.0"`;
`react-redux@9.2.0` peers `redux: "^5.0.0"`, `react: "^18.0 || ^19"`,
`@types/react: "^18.2.25 || ^19"`; RTK lists `redux` in `dependencies`.
design.md line 38 now states exactly this, including the correction that the typed
hooks are `react-redux`'s. Every clause checks out.

**CR3 — coverage assertion + selftest fixture. ADDRESSED.**
Decision 3 step 6 (line 79), task 2.3a (explicit `declaredIndependent` allowlist,
enumerated verbatim and matching the independent rows), task 2.5a (fails naming the
unaccounted package), and selftest fixture (e) in task 2.6. §Risks line 130 no longer
"accepts" the risk — both rot directions are mechanically detected. This is the
control that would have caught CR1.

**CR4 — AC2 terminating path. ADDRESSED in principle, unsound in mechanism.**
Decision 6 gains the local-probe prong (line 114) and tasks 4.5/4.6/4.7. The probe
*does* genuinely answer the question asked: the reported failure is a TS2322 typecheck
error, and root `typecheck` = `npm --prefix frontend run typecheck`, i.e. frontend's
own `tsc` against `frontend/tsconfig.json` — it needs no root `node_modules` (absent in
this worktree) and it exercises the real `CommandBar.tsx` call site. *But see Required
Revision 1 — "leaves no trace" is asserted, not procedurally guaranteed.*

**CR5 — pattern precision. ADDRESSED.**
design.md line 66 (exact package names, `@types/react*` as sole wildcard, `react`
never `react*`, matcher anchors both ends) plus tasks 3.1 and 2.4. Verified the live
config: the `/frontend` `react` group's patterns are `react`, `react-dom`,
`@types/react*` and `dev-dependencies` is declared first, so the reorder premise is
real.

### Independent checks this round

- `.github/dependabot.yml` read directly: 4 update configs, limits all `10`,
  `github-actions` and `sbt` both `patterns: ["*"]` — Decision 1's "already covered"
  claims confirmed.
- `.husky/pre-commit` insertion point (a flat `npm run check:*` list) and
  `.github/workflows/ci.yml` `frontend` job (`npm ci` → `npm --prefix frontend ci` →
  lint → typecheck → `format:check` → test) both exist as tasks 4.2/4.3 assume, and
  `check:dependabot` lands *after* `npm ci`.
- Root `node_modules` is **absent** in this worktree while `frontend/node_modules`
  exists — which is precisely the condition the gate-chain checklist's
  "no `node_modules` dependency" commitment (line 125) and task 2.2's
  "no YAML dependency" instruction exist for. That commitment is load-bearing here,
  not theoretical.
- Root `package.json` production deps = `["react-markdown"]` only; frontend
  devDependencies contain `@types/react` and `@types/react-dom`, so task 2.3's `react`
  family declaration will not trip the stale-declaration check.
- Validator/config consistency: `declaredIndependent` members deliberately resolve to
  *no* group, and Decision 3 step 5's "no group" failure is scoped to declared family
  members only — consistent with the spec delta's `axios` scenario. No contradiction.
- Decision 5 (HEL-874) re-examined cold: reason 2 (verifying native auto-merge would
  consume the very backlog this ticket must leave in a stated condition) is a real
  methodological conflict, not a rationalisation. Not overturned.

## Verdict: REFUTE

The enumeration is now correct and the two bad contract claims are fixed; CR3 and CR5
are properly mechanised. The refutation is narrow and cheap: the CR4 remedy as written
would violate this change's own Non-Goal on any literal execution, and two count/index
assertions in the artifacts contradict the artifacts themselves — the same class of
hand-maintained-number error that produced CR1.

## Change Requests

1. **Task 4.5's probe has no stated no-trace mechanism, and as written it conflicts
   with task 4.7.** "Install ... in a throwaway working copy" is not a procedure. The
   ordinary execution — `npm install @fortawesome/...@7.3.1` in `frontend/` — writes
   **both** `frontend/package.json` and `frontend/package-lock.json`, which task 4.7
   then asserts are unchanged, and which Non-Goal line 20 forbids. Specify the recipe
   explicitly: either (a) `npm --prefix frontend install --no-save --no-package-lock
   @fortawesome/fontawesome-svg-core@7.3.1 @fortawesome/free-solid-svg-icons@7.3.1
   @fortawesome/free-brands-svg-icons@7.3.1 @fortawesome/react-fontawesome@3.5.0`, or
   (b) a copy of the tree outside the repo. Additionally require a **restore step**
   (`npm --prefix frontend ci`) *before* the section-6 gates run, and state why: the
   probe mutates `frontend/node_modules`, so a task 6.4 `npm run typecheck` run
   afterwards would be certifying a tree nobody is shipping. Right now the plan runs
   the gates after the mutation with nothing putting the tree back.

2. **design.md line 93 still carries the pre-CR1 counts.** It reads "the frontend
   manifest has 17 production plus 15 dev entries". Measured: **18** production and
   **16** dev. This is the rationale for the `open-pull-requests-limit` raise in
   Decision 4, and it is the identical hand-maintained-number failure CR1 was about,
   left standing three lines below a corrected table. Fix both numbers.

3. **Task 6.2 asserts the wrong fixture count — internal contradiction.** It requires
   the selftest output to show "each of the **five** fixture cases evaluated"; task
   2.6 defines **six** ((a)–(f), the sixth being the CR3 coverage fixture). As written,
   a selftest silently omitting one case would satisfy 6.2. Change to six and, since
   this is the evidence assertion for CR3's control, require the output to name each
   case so the count cannot be met by a summary line.

## Non-blocking notes

- Task numbering: section "## 5." contains tasks `4.5`/`4.6`/`4.7`, colliding with
  section 4's `4.1`–`4.4`. Renumber to `5.1`–`5.3` when touching them for CR1 above.
- The probe answers the **typecheck** question only. The `frontend` CI job also runs
  lint, `format:check` and jest. Worth one clause in Decision 6 stating that AC2's
  "passes `frontend`" is still closed by the grouped PR; the probe closes the type
  contract specifically.
- Decision 1's coverage assertion (step 6) enumerates `dependencies` blocks only.
  Correct as scoped — every devDependency is already swept by the `dev-dependencies`
  catch-all — but saying so in one clause would pre-empt the obvious "why not dev too"
  question at review.
- `react-redux@9.2.0` also hard-peers `@types/react: "^18.2.25 || ^19"`, i.e. a second
  real edge between the `redux` and `react` families. Not an argument to merge the
  groups (the ranges are wide), but it is the strongest remaining un-noted contract in
  the table.
