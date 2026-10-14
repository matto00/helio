## Standing Constraints

- [C1] No bare count of step kinds or files (e.g. "27 step kinds") in the README outside a snapshot-labelled list + command
- [C2] The README must not say or imply nothing inference-related lives in `domain/steps/` (shared helpers like `JoinColumnNaming` are used by inference)
- [C3] No phrase HEL-1467 removed returns; task 1.5's zero-hit grep covers "all 23 step kinds", "Two step kinds have no capability spec", "21 `pipeline-*-op` specs", "rests on no governing statement"

## 1. Docs (README introduction only)

- [x] 1.1 Run the D1 `*Step` command and the D3 non-`*Step` command in the worktree; save full output to `evidence/claims.md`
- [x] 1.2 Rewrite README lines 3-9 per D1-D3 (snapshot labels, both fenced commands, no "one file per step type")
- [x] 1.3 Check lines 11-13 phrase by phrase per D4 (command + output each in `evidence/claims.md`); reword line 11's false "infer"
- [x] 1.4 Record every factual sentence of the new introduction with its verifying command + output in `evidence/claims.md`
- [x] 1.5 Grep the README for each HEL-1467-removed phrase (D4) and record zero hits

## 2. Tests

- [x] 2.1 `npx prettier --check backend/src/main/scala/com/helio/domain/steps/README.md` passes
- [x] 2.2 `git diff --stat` shows only the README and this change's artifacts; commit through the normal hook chain
