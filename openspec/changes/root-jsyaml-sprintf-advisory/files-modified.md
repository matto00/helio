- `package.json` — root `overrides` `@istanbuljs/load-nyc-config > js-yaml` retargeted `^3.15.2` -> `^4.1.1` (only change in this file)
- `package-lock.json` — regenerated; `.packages` key+version diff is exactly 4 removals (nested load-nyc-config js-yaml 3.15.2, nested argparse 1.0.10, `node_modules/esprima` 4.0.1, `node_modules/sprintf-js` 1.0.3). Disclosed: two stale nested entries (load-nyc-config js-yaml and argparse) were deleted by jq before re-running npm, because a plain re-run left js-yaml 3.15.2 in place (task 1.3)
- `.audit-ci.jsonc` — `"high": true` -> `"moderate": true`; header comment rewritten; HEL-1246 braces allowlist entry and its comment unchanged
- `.github/workflows/ci.yml` — security-job comment only: root gate now stated as "moderate"
- `docs/dependency-management.md` — frontend-gate paragraph: all three npm trees at moderate, root allowlist keeps the HEL-1246 entry
- `MISTAKES.md` — security-gate entry heading and body: all three trees at moderate; js-yaml 3.x/4.x "separate override floor" sentence reworded as history
- `helio-mcp/.audit-ci.jsonc` — header comment only: no longer claims the root is `"high": true`; line 5 (helio-mcp's own reason) kept
- `openspec/changes/root-jsyaml-sprintf-advisory/tasks.md` — checkboxes 1.1-3.5 ticked after verification
- `openspec/changes/root-jsyaml-sprintf-advisory/audit-proof.md` — proof transcripts
- `openspec/changes/root-jsyaml-sprintf-advisory/files-modified.md` — this handoff

Review base resolved live: `8364b3cee2a6d655749533363076a833d2305d02` (`resolve-review-base.sh`, exit 0).
