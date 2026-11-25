## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `344bde590afb0f409f704d33b1efa3157ba086fe` against the live-resolved base
`793802e50a8de763f905a431ca120490c372404d` (`resolve-review-base.sh`, exit 0).

### What I verified (with evidence)

- **Scope.** `git diff --stat BASE...HEAD`: the only file outside the change dir is
  `e2e/hel1510-output-editor-table-overflow.spec.ts` (+12 lines). That hunk adds only the
  `dialog.evaluate(... getAnimations() ... finished ...)` wait, placed after `expect(name).toBeVisible()` and before
  `contentRight(card)`. `+ 0.5`, `test.setTimeout(90_000)` and the retries are unchanged. No product code, schema or
  migration. AC3 met.
- **Probe fidelity.** `diff` of the base-commit spec (`git show 793802e50:e2e/...`) against `evidence/probe-spec.ts.txt`,
  and of the HEAD spec against `evidence/probe-spec-with-wait.ts.txt`, shows no deleted lines. The probes contain the
  real spec body plus additions only: the duration-stretch init script and logging.
- **Wait target.** `page.getByRole("dialog")` is the `<dialog className="ui-modal ...">` (Modal.tsx:261), the element
  `.ui-modal[open]` animates. My red runs logged `anims=[{"n":"ui-modal-in","d":840,...,"st":"running"}]` from that
  locator.
- **AC1, red under force (re-run by me, lane DB helio_hel1621, port 7053, 1 worker, nice -n 19).** Probe at 3x, no
  wait: 2 of 3 runs failed on the spec's own `toEqual([])` assertion (`ui-select__trigger right=870.2 limit=870.1`,
  `right=870.8 limit=870.8`). The passing run read limit 870.359 against maxRight 870.343. The red is real but
  probabilistic. That matches the evaluator's 5/9 and contradicts the evidence file's "reproduces reliably".
- **AC1, green under the same force with the wait.** 3/3 passed, and every run logged `limit=872.5 anims=[]`. The wait
  pins the read at rest (content-right 872.000), so it is deterministically load-bearing. The executor's mutation logs
  (wait removed: 3/3 red) agree with my no-wait runs, because the no-wait probe is the mutation: its body equals the
  HEAD spec minus the wait, plus the same probe additions.
- **AC2.** The real spec with `--repeat-each=20 --workers=2` and `nice -n 19`: **20 passed (1.0m)**, exit 0.
- **Gates on the changed file.** prettier --check passed, `tsc -p e2e/tsconfig.json --noEmit` exit 0,
  `eslint --max-warnings 0` exit 0.
- **C1 honesty.** The spec comment and `stretch-sweep.txt` claim only that the race is real and the wait is
  load-bearing. Neither claims the race caused the CI flake. The stretch factor, the 872.000 resting content-right and
  HEL-1613's numbers are logged. The deviation from 5-10x down to 3x is disclosed, and the sweep's 5x/10x passes
  support it (the edge moves too little between the reads).
- **D4 not triggered.** The force did go red, so adding the wait was correct per the ticket.
- **Debugging law.** This is not a product bug fix. The root-cause claim is scoped by C1, and the red/green pair under
  the same force is the regression evidence.
- **UI review.** Not applicable: no `frontend/**` change.
- **Gate-defect check.** No evidence here rests on mtime ordering. The red-before-fix ordering is by commit
  (f3235f41b precedes 344bde590).
- **Cleanup.** My temporary probe `e2e/zzprobe1621sk-*.spec.ts` is removed (`ls e2e | grep -c zz` = 0). Servers are
  stopped (`STOPPED ports=7053,9960`). The worktree is clean apart from the evaluator's uncommitted `evaluation-1.md`.
  Logs are in `.concertino/scratch/HEL-1621/skeptic/`.

### Verdict: CONFIRM

### Non-blocking notes
- `evidence/stretch-sweep.txt`: "the smallest-effort stretch that reproduces reliably" overstates it. Independent
  re-runs went red in 5/9 (evaluator) and 2/3 (skeptic). Reword it as probabilistic, with the with-wait read pinned at
  rest in every run.
- `evidence/probe-spec*.ts.txt`: the comment "0.28s -> 2.8s (10x)" is stale. The default is `PROBE_X=3` (840ms).
- `.catch` sits on `Promise.all` rather than on each `finished`. It behaves identically with the single `ui-modal-in`
  animation the Output editor has (no `expandFrom`).
