## Evaluation Report — Cycle 4 (evaluation-4.md, owner-granted extra cycle)

Reviewed HEAD `193b29c65902864ce258756635b8a576264846a8`. The live-resolved base is unchanged:
`bc2831cf2417af70eb0b48a315def723dcfb5485`.

I checked the owner ruling myself rather than relying on the relay. `.concertino/runs/HEL-1428/events.jsonl` line 32
is `escalation.answered`, with answer `js-yaml-rewrite`, `answer_source: human` and id
`HEL-1428-1791588642048-825444`. Constraint C4 is in `workflow-state.md` and `tasks.md`.

### Guard rewrite (C4): SOUND
`scripts/check-ci-complete-needs.mjs` now parses `ci.yml` with js-yaml `load` and checks the result fail-closed:
- a parse error fails (js-yaml rejects duplicate keys and multiple documents);
- `jobs` must be a non-empty mapping containing `ci-complete`;
- `needs` must be an array, so the scalar form and mappings are rejected;
- each entry must be a string matching `^[A-Za-z0-9_-]+$`;
- every entry must name a defined job, and every job other than `ci-complete` must be in `needs`.

Attack corpus, re-run independently:
- **Cycles 1-3 (27 fixtures):** all match js-yaml's own reading of `jobs` and `needs`. That includes all three
  multi-line-scalar fail-opens, which now report the truly missing job. The only PASS results (`aliasNeeds`,
  `bomJobs`, `plainCol0AfterGate`) are correct: by the parse, no job is missing in any of them.
- **New js-yaml-specific attacks (24):**

  | Attack | Result |
  |---|---|
  | `__proto__` (bare and quoted), `constructor` job keys | Correctly listed and reported missing; no prototype hiding |
  | `<<` merge into `jobs` | Merged job reported missing |
  | Second document `---` | Parse error |
  | `jobs` as a list, null, or absent | Error |
  | Document not a mapping; empty file | Error |
  | `!!set` needs | Rejected |
  | Custom `!foo` tag | Parse error |
  | `!!map` / `!!seq` tags | Same as untagged |
  | BOM | Stripped; missing job still reported |
  | `~` / `null` needs entries | Rejected |
  | Nested-list entry | Rejected |
  | Numeric job key `1` | Reported missing |
  | Complex `? [b]` key | Reported |
  | `ci-complete` as a list or null | Error |
  | Empty `needs` with jobs present | Error |
  | `ci-complete` as the only job with `needs: []` | PASS, which is correct |

- **Red-before-green:** I ran the HEAD selftest against the 2ba8bbbfb guard. The cycle-2 regression case fails there
  on reason text (it was caught as a duplicate key, not as job `b`). The cycle-3 case fails with `got []`, a
  confirmed false pass at 2ba8bbbfb. All of them pass at HEAD.
- **Mutation:** with the missing-job condition replaced by `if (false)` (scratch copy), the selftest reports 9 FAIL
  lines.
- **CLI red:** a scratch `ci.yml` with `docker-image` dropped from `needs` makes the CLI exit 1 and name the job.

Dependency and resolution:
- `package.json` and `package-lock.json` each gain exactly one line, `"js-yaml": "4.3.2"` in root
  `devDependencies`.
- The lockfile already held `node_modules/js-yaml` at 4.3.2 (`dev`). Re-resolving the committed `package.json` and
  lock in a scratch dir (`npm install --package-lock-only --ignore-scripts`) leaves the lock byte-identical, so
  `npm ci` will accept it.
- CI's `frontend` job runs `npm ci` at the root, so CI gets 4.3.2.
- This linked worktree has no root `node_modules` of its own. It resolves js-yaml from the ancestor main checkout
  (`/home/matt/Development/helio/node_modules/js-yaml`, currently 4.3.1, not reinstalled since the pin). `eslint`
  and the rest of the hook resolve the same way, which predates this change. Harmless: the API used, `load`, is the
  same in both versions.

The orchestrator asked about a `npx prettier --write` run with an empty argument. Nothing unintended landed:
- The commit touches only the expected 10 paths.
- The committed `evaluation-1/2/3.md` are byte-identical to my persisted copies.
- The cumulative branch diff is the 22 expected files (Dockerfile, `ci.yml`, the hook, `package*.json`, the two
  scripts, and the change dir).
- The worktree and the main checkout are both clean.

### Phase 1: Spec Review — FAIL (handoff declaration only)
- AC1-AC3 and AC5 pass, unchanged.
- AC4 passes: the guard now meets the spec requirement, and the spec, design D3 and proposal are updated for the
  parser.
- **Issue 1:** `openspec/changes/docker-copy-chown-needs-guard/files-modified.md` does not declare
  `package-lock.json`. Its `package.json` line also still says only "check:ci-complete-needs and :selftest
  scripts".
  - `scripts/concertino/squash-branch.sh` (lines 61-76) builds its allowlist from the change dir plus the paths
    declared in `files-modified.md`.
  - A staged `package-lock.json` outside that list is a loud stop with no commit, so Delivery's squash will refuse
    this branch as it stands.
  - The failure is loud, not silent, but it is certain.

### Phase 2: Code Review — PASS
Gates I ran fresh in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: clean.
- `check:ci-complete-needs` on the real file: OK.
- `check:ci-complete-needs:selftest`: all passed, including the three named REGRESSION cases.
- `check:precommit-ci-parity`: OK.
- `check:precommit-ci-parity:selftest`: 5/5.
- `check:openspec`: clean.

The code is small and readable, the comments explain why a parser is used and why the scalar form is rejected, and
there is no dead code.

### Phase 3: UI Review — N/A
No UI-affecting files changed.

### Overall: FAIL
The only issue is in the handoff declaration; the code and evidence pass. The fix is a change-dir edit and needs no
code change.

### Change Requests
1. In `openspec/changes/docker-copy-chown-needs-guard/files-modified.md`:
   - Add a bullet ``- `package-lock.json` — js-yaml 4.3.2 declared as a root devDependency (root entry only)``.
   - Amend the `package.json` bullet to mention the `js-yaml` devDependency.
   - Optionally confirm with a dry check that the bullet is picked up as path-shaped. It has a dotted extension, so
     it should be.

### Critical Path (beyond the configured 3 cycles, Overall FAIL)
- **What remains:** only Change Request 1, a one-line declaration fix that touches no code.
- **Recommendation:** the orchestrator (or the executor, in a sub-minute fix) adds the bullet. A re-check needs only
  to confirm that `files-modified.md` lists `package-lock.json` and that HEAD's code is otherwise unchanged from
  `193b29c65`. Everything substantive is verified PASS above.

### Non-blocking Suggestions
- js-yaml honors `<<` merge keys. My understanding, which I have not verified here, is that GitHub Actions' anchor
  support does not include merge keys. If so, a `<<` in `ci.yml` would make GitHub reject the workflow loudly, not
  silently. Rejecting `<<` keys in the guard for exact parity is optional.
