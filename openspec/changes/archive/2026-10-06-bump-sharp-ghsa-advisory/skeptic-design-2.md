## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `b16bfa1b3a74905eefc0208a01793efa047909c5` (branch `bug/bump-sharp-ghsa-advisory/HEL-1346`; only the change dir is untracked).
I started cold and re-derived every claim from the tree and the npm registry; I did not rely on the round-1 narrative.
npm calls used the scratchpad cache `hel1346-skeptic2-cache`, with Node v22.23.2 and npm 10.9.8.
I edited only scratch copies, in `scratchpad/hel1346-skeptic2-dry/{base,new}`.

### What I verified (with evidence)

**Round-1 change requests**
- **CR1 (parent-release facts): resolved.**
  - `npm view @vite-pwa/assets-generator time` lists 1.0.3 (2026-09-12T11:22Z), 1.0.4 (13:01Z) and 2.0.0 (15:37Z).
  - All three declare `dependencies.sharp ^0.35.4`.
  - 1.0.3 and 1.0.4 have `engines.node >=16.14.0`; 2.0.0 has `>=20.19.0`.
  - proposal.md Non-goals and design.md Context now state these facts correctly, and mark HEL-688's reason for the override as stale history.
- **CR2 (re-justify Decision 1): resolved.**
  - Decision 1 names options (a), (b) and (c) with the real reasons for each.
  - The (b) reasoning holds: 1.0.4's own `^0.35.4` still admits the vulnerable 0.35.4, so a manifest floor is still needed.
  - (a) is the smallest change, which is what the ticket asks for.
- **CR3 (dependent claim): resolved.**
  - A node scan of the lockfile `packages` finds exactly two dependents that declare `sharp`: `@vite-pwa/assets-generator` 1.0.2 (`^0.33.5`) and `sharp-ico` 0.1.5 (`*`).
  - design.md now names both.
- **CR4 (follow-up note): present** in Planner Notes, and not implemented, as requested.

**Re-verified ground truth**
- `frontend/package.json:40-42` has the scoped override `"@vite-pwa/assets-generator": { "sharp": "^0.35.4" }`.
- The lockfile has `node_modules/sharp` at 0.35.4, `dev: true`.
- Override history:
  - `git show 157e9ac37` (HEL-688) adds `^0.35.0`.
  - `git show 5bd45e346` (HEL-1055) raises it to `^0.35.4`.
- `npm view sharp dist-tags` returns `latest: 0.35.5`.
- `grep -c sharp` returns 0 for both the root `package-lock.json` and `helio-mcp/package-lock.json`.
- `ci.yml:383-386` runs the frontend audit as `working-directory: frontend`, `npx audit-ci --config .audit-ci.jsonc`. CI uses `node-version: 22`.
- `.audit-ci.jsonc` has `high: true` and `allowlist: []`.
- In `vite.config.ts`, `VitePWA` has no `pwaAssets` option, so `vite build` does not load sharp. The real consumer is `pwa-assets.config.ts`, which reads the SVG `public/orbit-mark.svg`.
- **I reproduced the churn claim independently.** On the scratch copies I raised the override to `^0.35.5` (`diff` shows that one line only) and ran `npm install --package-lock-only --ignore-scripts`.
  - Exactly 27 keys changed version or integrity: `node_modules/sharp` 0.35.4→0.35.5, 13 `@img/sharp-<platform>` 0.35.4→0.35.5, and 13 `@img/sharp-libvips-*` 1.3.3→1.3.4.
  - No key was added or removed.
  - `diff` shows 236 changed lines, which matches round 1's 118+/118-.
- **I reproduced red→green.** I ran `npm audit --package-lock-only --json` on both scratch copies.
  - Base: `high: 2`. They are `sharp`, via GHSA-wq5f-xc86-pv6w, and `@vite-pwa/assets-generator`, via sharp.
  - Bumped: `high: 0`, `critical: 0`, `moderate: 20`. The moderates are the pre-existing HEL-1320 ones and sit below `audit-ci`'s `high` threshold.
- **AC coverage:**

  | AC | Covered by |
  |---|---|
  | sharp ≥0.35.5 via the existing override, no allowlist | 1.2, 1.3, C3 |
  | Every changed lockfile package listed | 1.3, 2.5 |
  | Red→green locally | 1.1, 1.4 |
  | Red→green on CI | 2.6 |
  | build, lint, typecheck, Jest | 2.2 |
  | e2e | 2.6, the PR's CI |
  | PWA generation smoke test | 2.3 |
  | helio-mcp and root lockfiles checked | 2.4 |

- **Driver constraints:** C1–C4 mirror them, and no planned edit touches a forbidden path. The tasks contain no placeholders or TBDs, and the proposal, design and tasks do not contradict each other. `skip_specs: true` is appropriate because this change has no contract change.

### Verdict: CONFIRM

### Non-blocking notes
- Decision 2's allowed set is the prefix `node_modules/@img/sharp-*`. That prefix also matches the nested key `node_modules/@img/sharp-wasm32/node_modules/@emnapi/runtime` (1.11.3). That key did not change in my dry run. If it changes in the real regeneration, report it explicitly: it is a transitive move, not one of sharp's own pinned binaries.
- Task 2.3: `git ls-files frontend/public` tracks `apple-touch-icon-180x180.png`, `maskable-icon-512x512.png`, `pwa-192x192.png` and `pwa-512x512.png`. The `minimal2023Preset` may also emit an untracked `favicon.ico`. Remove that by its exact listed path, not by glob, which matches C4.
- CI pins Node 22 but not an npm version. Regenerate with npm 10.9.8, the same toolchain as the dry runs, so the lockfile metadata stays stable.
