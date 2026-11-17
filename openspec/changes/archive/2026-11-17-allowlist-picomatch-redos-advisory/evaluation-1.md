## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 46be359a8290219250c238d9212ac2a03ef763c9 against base 2e98eba92. This is a config-only change: two
`.audit-ci.jsonc` files plus openspec artifacts and evidence. Every gate below is my own fresh run. Scratch output
is in `.concertino/scratch/HEL-1751/eval/`.

### Phase 1: Spec Review — PASS
Each AC checked:
- AC1 (`"<GHSA>|<scope>*"` form, no bare id, no package-wide wildcard): PASS. Root has 43 entries and frontend/ has
  46. Every entry has the form `GHSA-fc5q-39xc-vjpf|<full package name>>*`. There is no leading `*` and no
  `picomatch*` or `jest*`.
- AC2 (comment with ticket, reason, paths, review-by 2026-12-17): PASS. Each tree has one block above its entries.
  - Root names jest/jest-util, jest-haste-map>anymatch, micromatch, typescript-eslint>tinyglobby and fdir. All of
    these appear in root's real reported paths (e.g. `jest-message-util>micromatch>picomatch>`, `fdir>picomatch`,
    `typescript-eslint>@typescript-eslint/typescript-estree>tinyglobby>picomatch`). Root does not claim vite,
    rollup or workbox, which is correct.
  - frontend/ names vite, rollup plugins, workbox-build and rollup-plugin-visualizer. All of these are in its
    closure. It does not claim micromatch, which is correct because micromatch is not in the frontend/ closure.
  - The frontend/ header's stale sentence "The allowlist is empty" was correctly removed.
- AC3 (exit 0 in both trees, and the same advisory via any other path still fails): PASS. See Phase 2.
- AC4 (`npm audit --omit=dev` is 0): PASS. Re-run in root, frontend/ and helio-mcp/: each printed
  `found 0 vulnerabilities` and exited 0.
- AC5 (HEL-1246 braces entry re-checked): PASS. I checked live with `gh api` that GHSA-vfj7-8cjw-p6xm has
  `withdrawn_at` 2026-10-23T12:53:02Z. A fresh root `npm audit --json` contains only GHSA-fc5q-39xc-vjpf, so
  removing the entry is the right branch, and design.md D5 states the reason.
- AC6 (PR `security` job green): cannot be checked before the PR exists. Every step the job runs passes locally
  with the same audit-ci 7.1.0 that both lockfiles pin.
- Standing Constraints:
  - C1 (verbatim reported path + `*`, grouping only as `<full-head>>*`): the executor uses the grouping clause. That
    is allowed, and it is recorded as an Implementation Deviation in design.md. I judge it justified and tight; see
    Phase 2.
  - C2 (installed CLI with a positive control): honored. The shim runs the real audit-ci binary on the real audit
    graph plus synthetic nodes.
- Spec deltas match the behavior. The frontend MODIFIED scenario now allows path-scoped allowlisted high findings,
  which matches the root wording. There is no scope creep: no package.json, lockfile or CI workflow edits.

### Phase 2: Code Review — FAIL (one hygiene item; the config itself is correct)
Gates (fresh, run in the worktree with the main checkout's audit-ci 7.1.0 binary, called by absolute path):

- **`audit-ci --config .audit-ci.jsonc`**: exit 0 on 5 of 5 runs in root and 5 of 5 runs in frontend/.
- **helio-mcp, in the CI form** (`audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`): exit 0.
- **`npm audit --omit=dev`**: 0 in all three trees.
- **Prettier** on the changed .jsonc and .md files: clean. The openspec files are prettier-ignored anyway.
- **Not run: frontend lint, test and build.** The only `frontend/**` file changed is `.audit-ci.jsonc`, which eslint
  (`src`), jest and vite never read. No source or behavior changed, so those gates cannot be affected.

Is the deviation from D2 justified? Yes, I reproduced the cause:
- I ran audit-ci 4 times per tree with an empty allowlist. The reported path sets differed between runs:
  - root: 30, 30, 32 and 30 paths, with 3 distinct md5 hashes;
  - frontend/: 35, 32, 35 and 32 paths, with 4 distinct hashes.
- Heads and trailing `>` both move between runs. For example, `jest-cli>jest-util>picomatch` in one run became
  `jest-cli>@jest/core>jest-haste-map>anymatch>picomatch>` in another.
- A verbatim per-path list would therefore re-red CI at random.
- Every head observed across all 8 runs is in the committed entry set: 37 of 43 for root and 38 of 46 for frontend/.

Is it tight? Yes:
- **The entries match the effects closure.** For root, the entries equal a fresh `effects` closure from picomatch
  exactly (43). For frontend/, the fresh closure is 45. The 46th entry, `@types/jest`, was in the executor's audit
  but not in mine. It is dev-only and harmless.
- **D3 re-check: all entries are dev-only.** Every entry's lockfile nodes are `"dev": true` in its tree. I found 0
  non-dev entries in either tree.
- **The executor's negative proof still holds when re-run.** It runs the real audit graph through the npm shim and
  the installed CLI against the committed configs. In both trees the control passes with exit 0. Each of these is
  reported and exits 1:
  - `prod-lib>micromatch>picomatch`
  - `prod-lib2>tinyglobby>picomatch`
  - bare direct `picomatch`
- **My own extra probes were all reported, each with exit 1.** These are the cases most likely to slip past
  grouped entries:
  - root:
    - `prod-app>jest-util>picomatch`: a prod node above a listed dev node.
    - `jest-newprod>picomatch`: a prefix collision with `jest`.
    - `jestx>@jest/core>...`
    - `prod-lint>typescript-eslint>...`
  - frontend/:
    - `prod-app>vite>picomatch`
    - `prod-app>jest-util>picomatch`
    - `vitex>picomatch`
    - `prod-sw>workbox-build>...`
  - This confirms the design argument: each newly reached node emits a full path headed by its own top-level
    dependent, so a prod head is never matched.
- **Mutation, reproduced.** Dropping `jest-util>*` makes the real audit fail in both trees (exit 1, reporting
  `jest-util>picomatch>`).
- **Residual risk is unchanged from design.md's Risks section.** If a listed dev package later became a prod
  dependency, its path would stay allowlisted. The review-by date and the comment's re-derive instruction mitigate
  this.

Issues:
1. **Stray scratch file committed.** `openspec/changes/allowlist-picomatch-redos-advisory/evidence/last.tmp` is
   1010 lines and byte-identical to `evidence/fe-audit-ci-after.txt` (checked with `cmp`). It is a leftover
   temporary file, not evidence. It duplicates a cited artifact and would be archived as noise.

### Phase 3: UI Review — N/A
No Phase 3 trigger matched in substance. The only `frontend/**` change is `frontend/.audit-ci.jsonc`, a CI audit
config that the app, its build and the dev server never read. `ApiRoutes.scala`, `schemas/**` and
`openspec/specs/**` were not touched; the spec deltas live under `openspec/changes/`. No observable UI behavior
can change, so I started no dev servers.

### Overall: FAIL

### Change Requests
1. `git rm openspec/changes/allowlist-picomatch-redos-advisory/evidence/last.tmp`, a stray temporary file and a
   byte-identical duplicate of `evidence/fe-audit-ci-after.txt`, and amend or add a commit. No other change is
   needed: the config, comments, spec deltas and proofs all pass as-is.

### Non-blocking Suggestions
- `evidence/negative-proof-control-sanity.txt` ends with a heading
  ("## control run, allowlisted paths audit-ci reports as matched (fe, first lines)") that has no content under it,
  and its "exit status of that: see below" line is confusing. Trim it, or fill in the section.
- `frontend/.audit-ci.jsonc` line 11 is a single comment line of about 190 characters, much longer than the rest
  of the block. Wrap it to match.
- frontend/'s `@types/jest>*` entry was not in a fresh effects closure on this run (45 vs 46). It is harmless
  because the package is dev-only, but the PR body could say the closure itself varies slightly between npm audit
  runs. That is another reason to group by package.
