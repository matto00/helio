## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 5ee152810cefd7a6690804f40c60cedae3c853cd. Diff base (resolve-review-base.sh, live): d60b1f799.

### What I verified (with evidence)

- **Spawn guard:** assert-cwd.sh printed `READY ambient=/home/matt/Development/helio branch=task/panel-card-skeleton-reads/HEL-1723`.
- **Scope and constraints:**
  - `git diff d60b1f799 HEAD --stat -- frontend backend schemas e2e/hel1685-draft-polish.spec.ts` is empty. There is no product code, and hel1685 is untouched.
  - The hel1681 diff is exactly 1 import line plus :332 and :343.
  - The e2e diff touches 6 spec files, and each change is a bare count or `.first()` read replaced by `waitForPanelGrid`/`waitForPanelStack`. No new helper was added.
  - `origin/main` moved to 0c699d263 after the base. That move touches only hel1631 and hel1685, and `git grep -c panel-grid-card` still returns 72 there, so it adds no new hits.
- **AC1, recount:**
  - `git grep -n "panel-grid-card" d60b1f799 -- e2e` returns 72 hits in 20 files, matching the per-file counts in sweep.md.
  - At HEAD the same grep returns 62, which matches sweep.md's arithmetic: 72 − 11 + 1.
  - I matched each of the 72 base file:line hits against sweep.md by hand. Every one has a verdict with a line reference, and all 17 hel1584-surfaces hits are accounted for.
- **AC1, spot-checks against the code:**
  - `PanelCardSkeleton.tsx:14-24` and `MobilePanelStackSkeleton.tsx:41-48` carry `__top`, `__title-area`, `__body-skeleton` and `__footer`. They have no `__title`, no `__handle`, no heading and no text. That confirms the OK-filtered rationale for the `__handle`, `__title`, heading-filter and `hasText` verdicts.
  - The skeleton does share `__top` and `__footer`, so the hel1398:167/168/174 and hel1444 `__top`/`__footer` reads depend on their `hasText`-filtered scoping, which sweep.md correctly labels OK-scoped rather than OK-filtered.
  - hel1023:236 runs after `openAt` → `waitForPanelGrid(page, 8)` at :364. Confirmed.
  - hel1392-burst:63 runs after `openDashboard` → :86 `waitForPanelGrid(page, 8)`. Confirmed.
  - hel1575-switch:48 resolves only when `withData >= want`, which counts cells only real cards have. Confirmed.
  - hel1584-perf:93-99: `visible` excludes `.crossfade__skeleton` cards. Confirmed.
  - `seedWorld` seeds 3 panels (m/c/t, motionPrimitivesSeed.ts), which justifies `waitForPanelGrid(page, 3)` in hel1681 and hel1573.
  - The hel1584-surfaces `openDashboard` viewport branch: the spec default is 1440 (:29), and the only resize is :450 (1440/375). The comment is accurate.
- **AC2, mutation re-run by me:**
  - Mutation: append `<span className="panel-grid-card__handle" />` after the `<h3>` in `MobilePanelStack.tsx:262`, served live on 7155.
  - **NEW spec** (`-g "xs: a container"`): exit 1, fails at `> 314 | ... .panel-grid-card__handle ... toHaveCount(0)` with `Expected: 0`, `Received: 2`. The `waitForPanelStack(page, 2)` before it passed, so the assertion now runs against a mounted stack.
  - **OLD spec** (base version written to a temporary `e2e/zz-skeptic-old-hel1028.spec.ts`), same mutation: exit 0, `1 passed (3.4s)`. This confirms the old assertion was vacuous.
  - Reverted with `git checkout` and removed the temp spec. Afterwards, `git status --short` shows only the untracked evaluation-2.md, and `git diff --stat -- frontend backend e2e` is empty.
  - The un-mutated xs test then ran green 3 times (`--repeat-each 3`: `3 passed (8.0s)`).
- **Gates, re-run fresh at HEAD:**
  - `npx eslint --max-warnings=0` on the 6 changed specs: exit 0.
  - `prettier --check` on the specs and the change dir: pass.
  - `npx tsc --noEmit -p e2e/tsconfig.json`: exit 0.
- **Playwright, all 6 changed specs:**
  - Every run used start-servers.sh/assert-phase.sh `PASS servers`, was pinned to `DEV_PORT=7155 BACKEND_PORT=10062`, and ran under `nice -n 19` with `--workers=2 --trace retain-on-failure`. `DEV_PORT is unset` appeared 0 times.
  - Result: `1 failed, 55 passed (3.7m)`. The failure was hel1681:289 ("Full motion: ... settling indicator"), a `TypeError` at :309 because `.mobile-panel-stack__item.first().boundingBox()` returned null.
  - That test body (:289-:312) is byte-identical to the base; the hel1681 diff touches only the import, :332 and :343. sweep.md already lists this exact read (hel1681:307) as a follow-up candidate: a bare, skeleton-shareable read with no `.panel-grid-card` string, which overlaps lane HEL-1692.
  - Reproduction check: `hel1681 --repeat-each 3` returned `45 passed (1.7m)`, exit 0. This is a pre-existing flake in unchanged code, not a stable failure caused by this change.
- Servers were stopped with stop-servers.sh (`STOPPED ports=7155,10062`).
- **UI judgment:** not applicable. This is a test-only change with no `frontend/**` diff.

### Verdict: CONFIRM

### Non-blocking notes
- hel1681:289 / :307 flaked once in my run: `boundingBox()` was null on the first `.mobile-panel-stack__item`, which can be a fading skeleton stub. This is out of scope, already recorded in sweep.md's follow-up list, and owned by HEL-1692's area. If HEL-1692 does not cover it, a follow-up ticket should convert it to `waitForPanelStack` plus `LIVE_STACK_ITEMS`.
- The PR body should name the hel1681 import line together with :332/:343 when it flags the overlap with HEL-1692. The evaluator made the same note.
