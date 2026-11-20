## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `015ac6d3674738687df9aecaccdc9ec56ef48653` against a live-resolved base `94a8ef292` (`resolve-review-base.sh`, exit 0).
Durable evidence root: `/home/matt/Development/helio/.concertino/runs/HEL-1774/evidence/.concertino/scratch/HEL-1774/` (cited below as `EV/`).

### What I verified (with evidence)

**Diff scope.** The product change is one declaration, `position: relative` on `.ui-modal__body`
(`frontend/src/shared/ui/Modal.css:193`). The rest is a comment-only edit to `OutputEditorSheet.css:28-31`, a
static jest guard in `Modal.css.test.ts`, six e2e spec files plus `e2e/support/modalScrollExtent.ts`, and openspec
artifacts.

**AC1 (inventory with measurements).** `evidence/inventory.md` has one row for each of the 30 `<Modal>`/`<BottomSheet>`
consumer files. Rows 1-22 are measured live (natural body and dialog scrollHeight against content, plus positioned
descendants and their containing block). Rows 23-30 are static, each with a reason and a grep I re-read. Every
`position: absolute` in those files has a `position: relative` parent rule. Met.

**AC2 (shared fix, justified against every child it moves).** I independently reviewed the app-wide effect:
- I listed every non-pseudo `position: absolute` selector in `frontend/src` (40 in total). Those reachable inside a
  modal body either have a positioned ancestor or are visually hidden: Toggle input, `.sr-only`,
  `.panel-detail-modal__upload-input`, scroll-fade, command-palette search icon, DataGrid handles inside sticky `th`,
  and `.motion-indicator` inside a relative SegmentedRadioGroup.
- Every popover is `position: fixed`, portalled or in place: `.popover__panel`, ActionsMenu, ProvenancePopover,
  OutputSchemaDisclosure, UserMenu, DashboardAppearanceEditor and the Select listbox. A fixed element's containing
  block is the viewport, so neither its placement nor the body's overflow clipping can change.
- Live check of the Select listbox inside the phone step sheet: rects were identical with the rule and with an inline
  `position: static` (trigger y 191, listbox y 239, both cases). The listbox portals into the dialog, not the body.
- Paint order (CommandPalette, BottomSheet) is pixel-identical:
  - Output editor 1280 dark, rule vs static: identical md5 (`EV/sk-oe-1280-dark-fixed.png` / `-static.png`).
  - Command palette 1280 light: identical md5 (`EV/sk-cp-1280-light-fixed.png` / `-static.png`). My first pair
    differed across the whole frame. That came from an entrance animation still in flight; after waiting for the
    animations to finish, the re-shot pair is identical.
- Hit-testing near the header boundary: I sampled `elementFromPoint` across the band ±16 px around the body's
  top and bottom edges on the phone BottomSheet step sheet. The only change is the shared seam row y=81.5 between the
  header (bottom 82) and the body (top 82), which now resolves to the body container instead of the header container.
  No interactive element and no tap expander changes owner.
- `offsetParent` changes for unpositioned body descendants. The only users (`useLayoutSlide`, `useIndicatorSlide`)
  read deltas or sit inside their own relative container. No regression.
- Met. The choice of a shared rule over per-modal fixes is justified.

**AC3 (guard red on the defect; desktop + phone; light + dark).**
- My green run on the fix covered the 6 files with default rate limits and 2 workers: 34 passed, 4 skipped, max 60 s
  window 74 requests, zero 429 (`EV/skeptic-green.txt`).
- My red run removed the shared rule (one-line mutation, restored, `git status` clean): 32 failed, 2 passed (the
  popover GUARDs), 4 skipped (`EV/skeptic-red.txt`). The injected case is red for all 20 non-guard modals at every
  reachable viewport and theme. step-palette and command-palette are never red, which matches their GUARD labels.
  Zero natural cases are red, which matches the claim that the natural cases are guards.
- So C15 holds: the injected case is built on an overflowing body and is red without the rule.
- Jest Modal suites: 5 suites, 49 tests passed.

**CI soundness of the six files.**
- `node scripts/e2e-shard.mjs plan` discovers all six as top-level files (the tests live in a support module, but the
  shard script keys on the top-level suite file). They spread across legs 1-4, 6 and 7 at the defaulted 50 s.
- Measured per-file serial time is about 50-104 s (shell is the heaviest). With 2 workers a leg absorbs that, so the
  default weight is a fair approximation until the table regenerates from CI.
- One user per test, peak 74 of 120 per 60 s. No source-preview route is used, so the 30/60 s source-fetch limiter is
  not engaged. `check:e2e-user-cleanup`, `check:e2e-evidence-paths` and `check:e2e-types` are clean.
- e2e selector grep: `.ui-modal__body` is read by hel1510, hel1744, hel1763, hel1582 and touchTargetProbe (comment
  only). The first four are in the executor's regression sweep (`regression-sweep-regress*.txt`, 37 + 30 passed). The
  hel1744 `bodyOver` scrollWidth check is the one place where absolute children now count toward body overflow, and it
  passed.

**Iron Laws.** The root cause is probe-confirmed (HEL-1763 numbers reproduced by mutation b). Red-before-green is
shown by committed red run `3129212f4` plus my own reproduction. Nothing here rests on mtime ordering. The evidence is
content-based (md5, rects, pass/fail counts).

### Verdict: CONFIRM

### Non-blocking notes
- `frontend/src/shared/ui/Modal.css.test.ts:179` says the live proof is `e2e/hel1774-modal-scroll-extent.spec.ts`,
  which no longer exists after the cycle-3 split. It should point at `e2e/hel1774-modal-scroll-*.spec.ts` /
  `e2e/support/modalScrollExtent.ts`. This is a dangling reference in a comment, worth a one-line fix before merge.
- The `e2e/shard-weights.tsv` rows for the six files are defaulted at 50 s; shell's real time is about 104 s serial.
  Regenerate from CI artifacts as the script's header prescribes. Do not hand-edit.
- Housekeeping: I registered one throwaway user (`hel1774-skeptic-1795152621548@example.test`). It was deleted by
  exact id with the HEL-1301 cleanup SQL (0 rows remain). Servers were stopped with `stop-servers.sh`.
