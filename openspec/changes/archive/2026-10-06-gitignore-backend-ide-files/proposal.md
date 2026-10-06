## Why

HEL-1287 (#773) replaced the blanket `backend/project/` ignore with four narrow rules so build sources under `backend/project/` could be tracked. That left Metals' generated `backend/project/metals.sbt` unignored: every main checkout with Metals installed now shows it untracked, which makes `cleanup.sh --phase4` report `base=dirty` and refuse to fast-forward `main` after every delivery. Separately, CI has written an unignored `backend/.jvmopts` since HEL-1273; a local copy committed by accident would change every developer's sbt heap.

## What Changes

- Add `backend/.jvmopts` to `.gitignore`.
- Add `backend/project/metals.sbt` to `.gitignore`, alongside #773's narrow `backend/project/` rules.
- No other file changes; the tracked files under `backend/project/` stay tracked.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a repository-hygiene change with no spec-level behavior; `.openspec.yaml` sets `skip_specs: true`.

## Impact

- `.gitignore` only.
- Main checkouts with Metals stop showing `?? backend/project/metals.sbt`, so `cleanup.sh --phase4` can fast-forward `main` again.
- No build, runtime, or CI behavior change. CI still writes `backend/.jvmopts`; it is simply ignored.
