## Context

See proposal.md — Why. Verified against the live tree at base `b16bfa1b3` (Setup premise validation):

- `frontend/package-lock.json` has exactly one `node_modules/sharp` entry, 0.35.4, `dev: true`. Its dependents are
  `node_modules/@vite-pwa/assets-generator` 1.0.2 (`"sharp": "^0.33.5"`) and `node_modules/sharp-ico` 0.1.5
  (`"sharp": "*"`), itself a dependency of the assets generator, so both sit inside the scoped override's subtree.
- The mismatch is explained by a scoped override in `frontend/package.json`:
  `"@vite-pwa/assets-generator": { "sharp": "^0.35.4" }`. HEL-688 (157e9ac37) added it as `^0.35.0` because the
  parent, already at its latest release, still pins `^0.33.5` (so a parent bump cannot clear sharp advisories).
  HEL-1055 (5bd45e346) raised the floor to `^0.35.4` for that day's advisory. This ticket is the same move again.
- `npm view sharp`: 0.35.5 exists, dist-tag `latest`.
- `@vite-pwa/assets-generator` (corrected after design round 1): 1.0.3 and 1.0.4 (both within the declared `^1.0.2`)
  and 2.0.0 (major, `engines.node >=20.19.0`, dist-tag `latest`) were all published 2026-09-12 and all declare
  `sharp ^0.35.4`. HEL-688's reason for the override ("parent pins `^0.33.5`") is therefore stale history: it still
  explains why the locked 1.0.2 needs the override, but no longer describes upstream.
- Root `package-lock.json` and `helio-mcp/package-lock.json`: zero occurrences of `sharp`.
- `frontend/.audit-ci.jsonc`: `"high": true`, `allowlist: []`. CI step "Frontend audit (frontend/)":
  `npx audit-ci --config .audit-ci.jsonc`, working-directory `frontend` (ci.yml lines 383-386; not modified).
- sharp's consumer is `pwa-assets-generator` (`npm run generate-pwa-assets`, config `frontend/pwa-assets.config.ts`,
  source `public/orbit-mark.svg` — an SVG, i.e. exactly the librsvg path). `vite.config.ts` does not reference the
  assets generator, so `vite build` never loads sharp.
- Orchestrator dry run (scratch copy of package.json + lockfile, override raised, `npm install --package-lock-only`):
  the changed-version key set was exactly `node_modules/sharp` and 26 `node_modules/@img/sharp-*` entries
  (`sharp-<platform>` 0.35.4→0.35.5, `sharp-libvips-<platform>` 1.3.3→1.3.4). No other key added/removed/changed.

## Goals / Non-Goals

**Goals:** sharp ≥0.35.5 in the lockfile; frontend audit step green; lockfile diff confined to the sharp family.

**Non-Goals:** see proposal.md — Non-goals.

## Decisions

1. **Raise the existing override floor to `^0.35.5`, then lock-only regenerate (option a).** Alternatives weighed:
   - (a) Override floor only — reproduced 27-key, sharp-family-only churn (sharp + 26 `@img/sharp-*`). Encodes the
     security minimum in the manifest, matching HEL-1055's identical move. **Chosen.**
   - (b) Lock-refresh the parent to 1.0.4 (in range). Its own `sharp ^0.35.4` still admits vulnerable 0.35.4, so it
     sets no security floor by itself; the floor override would still be needed, and the parent version change (plus
     any of its own transitive moves) is added churn for no security gain.
   - (c) Bump the parent to 2.0.0 — major version, new Node engine constraint, out of scope for an urgent patch.
   Also rejected: a pure lock refresh without the floor (`^0.35.4` admits 0.35.5, but leaves no manifest floor);
   `npm audit fix` (moves unrelated packages); allowlisting (needs an owner ruling); a new top-level `sharp` override
   (broader than the existing scoped one). Command: `npm install --package-lock-only --ignore-scripts` (or
   `npm update sharp --package-lock-only`) in `frontend/`, npm 10.9.8 / Node 22 to match CI, scratchpad
   `npm_config_cache`.
2. **Churn check is mechanical.** Diff the `packages` maps of base vs branch lockfile (node over `git show
   <base>:frontend/package-lock.json`) and list every key whose `version` differs or which was added/removed. The
   allowed set is `node_modules/sharp` plus `node_modules/@img/sharp-*`. Anything else fails the task; investigate
   rather than hand-edit around it. The `@img/*` moves are not churn: they are sharp 0.35.5's pinned exact-version
   optional deps, and the `sharp-libvips-*` 1.3.4 binaries are what actually carry the librsvg fix.
3. **Red→green with the exact CI command.** From `frontend/`, run `npx audit-ci --config .audit-ci.jsonc` on the
   base lockfile (expect exit 1 citing GHSA-wq5f-xc86-pv6w) and on the branch (expect exit 0), keeping full
   transcripts under the session scratchpad with a `hel1346-` prefix. CI's own `security` job on the PR is final.
4. **Installed tree matches the lockfile before gates.** `npm ci` in `frontend/` after the change (MISTAKES.md: a
   local gate run against a stale install proves nothing), then `npm ls sharp` must show 0.35.5 deduped under
   `@vite-pwa/assets-generator`.
5. **sharp smoke test via the real consumer.** Because the build doesn't load sharp, prove the bump works by running
   `npm run generate-pwa-assets` (rasterises the SVG through librsvg) and checking it exits 0 and writes its PNGs.
   It writes into tracked `frontend/public/`; afterwards restore exactly the paths `git status --porcelain` lists
   (tracked: `git restore -- <path>`; untracked: remove that exact path) so no regenerated icon is committed. Also
   run `node -e "require('sharp')"`-style version check from `frontend/` to confirm the native binary loads.

## Risks / Trade-offs

- [Native binary fails to load on CI/Linux] → `npm ci` + sharp load + generate-pwa-assets locally; CI `npm ci` proves
  the platform package resolves.
- [npm version differences rewrite unrelated lockfile metadata] → Decision 2's key-set check covers versions; also
  eyeball `git diff --stat` for unexpected line volume.
- [Another advisory published mid-run] → re-run the audit immediately before the PR; out-of-scope findings are
  escalated, not silently fixed.

## Planner Notes

- Self-approved: dev-only, patch-level bump via an existing override; no new dependency, no API change.
- Driver constraints: no `frontend/src`, `ci.yml`, `playwright.config.ts`, `.gitignore` edits; one CI run at a time;
  no writes under `~` (scratchpad npm cache/logs, never committed); no pattern-selected kill/delete targets.
- Follow-up noted (not filed): once the parent moves to ≥1.0.3, reconsider whether the scoped override can be
  reduced to a pure security floor or dropped.
- e2e AC is satisfied by the PR's CI e2e job (this change cannot affect runtime code — sharp is not in the app bundle).
