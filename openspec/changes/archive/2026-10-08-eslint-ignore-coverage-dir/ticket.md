# HEL-1375: Root eslint.config.cjs does not ignore coverage/ — a local jest --coverage breaks lint and the pre-commit hook

## Description

Follow-up from HEL-1364 (origin_kind: followup, origin_ticket: HEL-1364). Priority: Low.

### Problem

The root `eslint.config.cjs` ignore list (node_modules, dist, build, backend/target, openspec, .cursor,
.claude/worktrees, .concertino) has no `coverage/` entry. Running `jest --coverage` at the root writes generated
`coverage/**` JS, after which `npm run lint` and the Husky pre-commit hook fail on generated files outside the
committer's diff. That invites a `-n` bypass, the same failure mode the file's own `.claude/worktrees` comment
describes.

Found by HEL-1364's executor (it ran `jest --coverage` in its worktree and broke lint). Evaluator and final skeptic
both confirmed it is real.

## Acceptance criteria

- `**/coverage/**` is ignored by the root flat config, with a short reason comment in the file's existing style.
- Proof: after `npx jest --coverage` (any small subset) at the root, `npm run lint` exits 0. Show it red before the
  change and green after.
- Check whether `frontend/` and `helio-mcp/` lint configs have the same gap, and fix them in the same change if so.
