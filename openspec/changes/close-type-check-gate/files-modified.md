# Files Modified — HEL-683 / close-type-check-gate

- `frontend/package.json` — added `"typecheck": "tsc --noEmit"` script, adjacent to `lint` (D2).
- `package.json` — added root `"typecheck": "npm --prefix frontend run typecheck"` passthrough, adjacent to `lint` (D2; worktree-robust per design.md, unlike `npx tsc --noEmit -p frontend`).
- `frontend/tsconfig.json` — corrected `include` from `["src", "tests"]` (phantom `tests` dir) to `["src", "vite.config.ts", "pwa-assets.config.ts"]`, widening the type-checked surface to the frontend's only tracked TypeScript outside `src` (D4).
- `.husky/pre-commit` — added `npm run typecheck` immediately after `npm run lint` (D3).
- `.github/workflows/ci.yml` — added `- run: npm run typecheck` to the `frontend` job, immediately after `npm run lint` (D3); mechanically asserted via `python3 -c "import yaml"` to be present, correctly scoped, and unneutered.
- `CONTRIBUTING.md` — added `npm run typecheck` to the Pre-Commit Policy command list.
- `CLAUDE.md` — added `npm run typecheck` to the frontend command list, and updated the "Pre-commit hooks" prose (previously understated as "ESLint, Prettier, and Jest") to name every hook step.
- `README.md` — added `npm run typecheck` to the frontend command list.
- `.cursor/skills/linear-ticket-delivery/SKILL.md` — added `npm run typecheck` to the frontend verification-gate list (hand-maintained; not covered by D6's `concertino sync` deferral).
- `openspec/changes/close-type-check-gate/tasks.md` — all 27 tasks ticked; task 5.5's sweep decisions (update-or-exempt per hit) recorded inline as durable evidence.
- `openspec/changes/close-type-check-gate/files-modified.md` — this file.

## Not modified (exempt / fenced / deferred, with reasoning)

- `concertino.config.json` and `.claude/agents/concertino-{executor,evaluator}.md` — D6: adding a `typecheck` gate entry requires a `concertino sync` re-render, disallowed this run (CON-128); hand-editing the rendered `.md` files would create config↔render drift. Residual gap, named in the PR.
- `openspec/specs/**` — fenced this run; HEL-775 owns that tree concurrently. Archived with `--skip-specs` (D7).
- `scripts/check-openspec-hygiene.mjs` — fenced this run; not touched, not needed for this change.
- No `frontend/src` source files were modified — AC 1 ("`npx tsc --noEmit -p frontend` exits clean") was already satisfied on the base commit; this change is tooling/gate-only, per the ticket's provenance note.
