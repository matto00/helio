## Standing Constraints

- [C1] Doc/comment-only: the diff touches exactly `frontend/src/utils/README.md` and `frontend/src/utils/prefersReducedMotion.ts` (plus this change dir).
- [C2] Every factual claim written is backed by a pasted command output in `openspec/changes/fix-utils-readme-importers/evidence.md`.

### Frontend

## 1. README importer facts

- [x] 1.1 Run design.md Decision 1's verification command; paste its full output into `evidence.md` under `## Importer grep`; verify it matches design.md Context's lists (stop and report if not).
- [x] 1.2 Replace README.md lines 3-9 (line 3 starts "`formatRelativeTime.ts` is genuinely", line 9 is "docs-only.") with Decision 1's exact text; verify with `sed -n 1,20p frontend/src/utils/README.md` and that `grep -n "docs-only\|exclusively" frontend/src/utils/README.md` prints nothing.

## 2. JS-gating sentence

- [x] 2.1 Run `grep -n 'endsWith(".css")' frontend/src/theme/motionTokenGuard.css.test.ts` and `grep -n "prefersReducedMotion()" frontend/src/features/panels/ui/buildChartOption.ts`; paste both outputs into `evidence.md` under `## Guard and call-site grep`.
- [x] 2.2 Insert Decision 2's exact lines into `prefersReducedMotion.ts`'s doc comment; verify with `sed -n 1,16p frontend/src/utils/prefersReducedMotion.ts`.

### Tests

## 3. Verification

- [x] 3.1 `npx prettier --check frontend/src/utils/README.md frontend/src/utils/prefersReducedMotion.ts` passes (explicit file args only).
- [x] 3.2 `npm --prefix frontend test -- --testPathPatterns=prefersReducedMotion` passes; before committing, `git status --short` lists only the two files plus the change dir; after committing, `git diff --stat origin/main...HEAD` lists the same.
- [x] 3.3 `evidence.md` holds both pasted grep outputs verbatim (the orchestrator copies them into the PR body at Delivery, per AC1).
