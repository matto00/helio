## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `8d7bdffc70bd25c696ae58f4c68c4e569f2b5470` against a live-resolved base `94a8ef292ba5475e3906c2aa5760110a9d23abe9`
(`resolve-review-base.sh`, exit 0; same base as round 1).
Durable evidence root: `/home/matt/Development/helio/.concertino/runs/HEL-1774/evidence/.concertino/scratch/HEL-1774/` (cited below as `EV/`).

### What changed since the last final gate, and how much re-verification it needs

- `git diff 015ac6d36 HEAD --stat` shows one file and one line: `frontend/src/shared/ui/Modal.css.test.ts:180`, inside a `//`
  comment. It now points at `e2e/hel1774-modal-scroll-*.spec.ts` and `e2e/support/modalScrollExtent.ts`. I listed all 7 files
  and they exist. This resolves round 1's dangling-reference note.
- Product CSS (`Modal.css`, `OutputEditorSheet.css`), the e2e specs and the support module are byte-identical to what round 1 reviewed.
  The risk from the delta is close to zero. I did not want to rest the verdict only on round 1's narrative, so I took one fresh
  green/red reading of the discriminator myself (below) and checked round 1's evidence by its content.

### What I verified (with evidence)

**Fresh gates on the changed file.**
- `npx jest --maxWorkers=3 src/shared/ui/Modal.css.test.ts`: 1 suite, 10 tests passed.
- `prettier --check` on the file: clean.
- `eslint --max-warnings 0` on the file: exit 0.

**Product diff, re-read at this HEAD.**
- `Modal.css:193` adds `position: relative` to `.ui-modal__body`, with a justification comment.
- `OutputEditorSheet.css` changes a comment only. The HEL-1763 `position: relative` stays.
- The static jest guard checks that `.ui-modal__body` has position relative and still scrolls, with no `contain` or transform.

**AC3 discriminator, a fresh red/green taken by me.** I used lane servers on 7206/10113 (`start-servers.sh`, `assert-phase.sh servers`
PASS), Playwright with 2 workers and `nice -n 19`, on `e2e/hel1774-modal-scroll-pipeline-dialogs.spec.ts`.
- Green on HEAD: 8 passed, 0 failed (`EV/skf2-green.txt`).
  - That run's globalTeardown errored because I had not yet exported the lane `DATABASE_URL`, so cleanup went to the
    default DB and matched 0 of 8 users.
  - Those 8 users were then deleted from `helio_hel1774` by exact id and email, through the harness's own `deleteRecordedUsers`
    (it prints "deleted 8"). The registry dir is now empty.
  - This was my environment slip, not a product or test defect.
- Red with the shared rule removed: I deleted only `Modal.css:193`, ran the spec, then ran `git checkout` on the file. `git status`
  afterwards shows only the pre-existing untracked reports.
  - Result: 6 failed, 2 passed (`EV/skf2-red.txt`).
  - The 6 failures are every viewport × theme: 375/390/1280 in light and dark. Each fails on the **injected** case, e.g.
    `pipeline-share 375x812 light injected: dialog scrollHeight 1950 vs content bottom 729.8`.
  - The 2 passes are the popover GUARD tests, as their label says.
  - So C15 holds: the injected case is built on an overflowing body, is red without the rule, and the cases that stay green are labelled guards.

**Round 1's evidence, checked by content, not narrative.**
- `EV/skeptic-green.txt` ends with 34 passed and 4 skipped.
- `EV/skeptic-red.txt` lists the failed shell cases at every viewport and theme, then 2 passed and 4 skipped.
- The md5 sums of the paint-identity pairs match: `sk-oe-1280-dark-{fixed,static}.png` are both `874263c4…`, and
  `sk-cp-1280-light-{fixed,static}.png` are both `7ecc4b48…`.
- With CSS and e2e unchanged since then, the round-1 AC1 inventory and the AC2 per-child justification still apply. My one-file
  re-measurement above agrees with them.

**AC trace.**
- AC1: `evidence/inventory.md`, 30 modal/sheet consumers, measured or statically justified.
- AC2: one shared rule, `Modal.css:193`, justified against every absolute child. Popovers are `position: fixed` and unaffected, and the paint md5s are identical.
- AC3: the e2e guard is red on the defect at desktop and phone, in light and dark, as reproduced above, plus the static jest guard.

**UI/design.** The only product change is a containing-block declaration with no visual effect. Round 1 showed pixel identity by md5, and the CSS is unchanged since.
No new screenshots were warranted. No mtime-ordering evidence is relied on.

### Verdict: CONFIRM

### Non-blocking notes
- Round 1's note on `e2e/shard-weights.tsv` still stands: the new files carry the default 50 s weight. Regenerate it from CI artifacts; do not hand-edit it.
- Housekeeping: servers were stopped with `stop-servers.sh` (STOPPED 7206,10113), all 16 throwaway users from my two runs were deleted
  by exact id, and the mutation was restored (`git status` clean apart from the untracked reports).
