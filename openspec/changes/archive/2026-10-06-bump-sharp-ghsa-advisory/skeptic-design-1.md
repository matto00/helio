## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `b16bfa1b3a74905eefc0208a01793efa047909c5` (branch `bug/bump-sharp-ghsa-advisory/HEL-1346`, change dir untracked).
I verified every claim in the planning artifacts against the live tree and the npm registry. npm calls used the scratchpad cache `hel1346-skeptic-cache`.

### What I verified (with evidence)

**Claims that hold**
- The lockfile has exactly one `node_modules/sharp`, at 0.35.4, `dev: true`. It also has 26 `node_modules/@img/sharp-*` entries: 0.35.4 for the platform packages and 1.3.3 for libvips. Checked with a node script over `frontend/package-lock.json` `.packages`.
- `node_modules/@vite-pwa/assets-generator` is 1.0.2 and declares `sharp: ^0.33.5`.
- `frontend/package.json:40-41` has the scoped override `"@vite-pwa/assets-generator": { "sharp": "^0.35.4" }`.
- The override has the history the design gives:
  - `git show 157e9ac37 -- frontend/package.json` adds `"sharp": "^0.35.0"`. That is HEL-688, whose commit message says the parent "still pins sharp ^0.33.5".
  - `git show 5bd45e346` raises it to `^0.35.4`. That is HEL-1055, for GHSA-g89c-p67h-r497 / GHSA-2jg2-4ch7-h545.
- sharp is published at 0.35.5 with dist-tag `latest` (`npm view sharp dist-tags`). It pins `@img/sharp-libvips-*` at 1.3.4.
- `grep -c sharp` returns 0 for both `package-lock.json` (root) and `helio-mcp/package-lock.json`.
- `.github/workflows/ci.yml:383-386` is the "Frontend audit (frontend/)" step: `working-directory: frontend`, `npx audit-ci --config .audit-ci.jsonc`. `frontend/.audit-ci.jsonc` has `"high": true` and `allowlist: []`.
- `frontend/vite.config.ts` uses `VitePWA` with `includeAssets` only. It has no `pwaAssets` option, so vite-plugin-pwa never loads the optional `@vite-pwa/assets-generator` peer, and `vite build` does not load sharp. The only consumer is the `generate-pwa-assets` script (`frontend/package.json:11`), configured in `frontend/pwa-assets.config.ts` with SVG input `public/orbit-mark.svg`.
- **I reproduced the churn claim.** I copied package.json and the lockfile to scratch, raised the override to `^0.35.5`, and ran `npm install --package-lock-only --ignore-scripts` with npm 10.9.8.
  - Exactly 27 package keys changed: `node_modules/sharp` 0.35.4→0.35.5 plus the 26 `@img/sharp-*` entries.
  - Nothing changed outside the sharp family.
  - The diff stat is 118+/118-.
- **I reproduced red→green with npm audit** on the same scratch copies:
  - Base: `high: 2`, from `sharp` via GHSA-wq5f-xc86-pv6w and `@vite-pwa/assets-generator` via sharp.
  - After the bump: `high: 0`, `moderate: 20`. The moderates are the pre-existing HEL-1320 ones and are below the audit threshold.
- The tasks cover every AC: version bump, churn list, local and CI red→green, build/lint/typecheck/Jest, e2e via the PR's CI, and a smoke test of PWA generation. The tasks contain no placeholders, and none of the planned edits touch a forbidden path.

**Claims that are false**
- **"`@vite-pwa/assets-generator` has no newer release"** (design.md Context) and **"1.0.2 is its latest release and still declares `sharp ^0.33.5`"** (proposal.md Non-goals) are both wrong. `npm view @vite-pwa/assets-generator time`, run twice with the same result, lists:
  - `1.0.3`, published 2026-09-12T11:22Z, with `sharp ^0.35.4`
  - `1.0.4`, published 2026-09-12T13:01Z, with `sharp ^0.35.4`
  - `2.0.0`, published 2026-09-12T15:37Z, with `sharp ^0.35.4`, `engines.node >=20.19.0`, and `dist-tags.latest = 2.0.0`

  1.0.3 and 1.0.4 already satisfy the declared range `"@vite-pwa/assets-generator": "^1.0.2"` (`frontend/package.json:51`). Decision 1's premise, "The parent can't move (latest release still pins `^0.33.5`)", is therefore false. Since 2026-09-12 the parent can move, even without changing its declared range.
- **"Its only dependent is `node_modules/@vite-pwa/assets-generator`"** (design.md Context) is wrong. `node_modules/sharp-ico` 0.1.5 also declares `sharp: "*"`. It is a dependency of the assets generator, so the scoped override still reaches it and the outcome does not change, but the statement is false as written.

### Verdict: REFUTE

The mechanics are sound and I reproduced them. The bump clears the advisory with exactly the sharp-family churn the plan predicts. The problem is the explanation. The ticket asks the delivery to check the override and explain why the lock resolves 0.35.4, and to choose between "update the existing override or the parent". The plan's explanation and its decision rest on a false fact: that the parent has no newer release and still pins `^0.33.5`. If it ships as written, the PR and `files-modified.md` will carry that error, and the override-vs-parent choice the AC asks for was never actually weighed.

### Change Requests

1. **Correct the parent-release facts.** Update proposal.md Non-goals and design.md Context and Decision 1 to say:
   - `@vite-pwa/assets-generator` 1.0.3 and 1.0.4 are within the existing `^1.0.2` range, and 2.0.0 is a major release. All were published 2026-09-12, and all declare `sharp ^0.35.4`.
   - HEL-688's reason for the override, that the parent pins `^0.33.5`, is therefore stale history. It still explains why the 1.0.2 lock needs the override, but it no longer describes the upstream state.
2. **Re-justify Decision 1 against the real alternatives.** Name each alternative and its result:
   - (a) Raise the override floor only. This is the current plan, with a reproduced 27-key, sharp-only churn.
   - (b) Lock-refresh the parent to 1.0.4 in range. Its own `^0.35.4` still admits vulnerable 0.35.4, so it does not set a security floor in the manifest by itself, and it adds a parent version change to the churn.
   - (c) Bump the parent to 2.0.0. This is a major version, has a Node engine constraint, and is out of scope.

   I think (a) is still defensible as the smallest change, but the design has to say so for these real reasons. If the planner prefers (b) together with the floor, the churn list must include the parent's version change.
3. **Fix the dependent claim.** Change "Its only dependent is …" in design.md to name `sharp-ico` (`sharp: "*"`) as well, and say that it is inside the scoped override's subtree. Make the same correction anywhere the dependency path will be restated, such as `files-modified.md` and the PR body.
4. **Optional, recommend only:** record a non-blocking follow-up note. Once the parent is bumped to ≥1.0.3, the scoped override could be reconsidered or reduced to a pure security floor. Do not implement this in this ticket.

### Non-blocking notes

- The scratch dry run used npm 10.9.8 and Node v22.23.2. Use the same toolchain when regenerating so lockfile metadata does not churn.
- In task 2.3, restoring exactly the `git status --porcelain`-listed `frontend/public/` paths is the right approach. Those PNGs are tracked, so `git restore` should cover all of them. Do not glob.
- `skip_specs: true` is appropriate: this is a dependency patch with no contract change.
