## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `0a5f38fc77c905e08894381e3656f511d373cfee` (executor commit fe2bfc4d9 plus a clean merge of origin/main
54f2943cd). The base was resolved live with `resolve-review-base.sh` and gave `54f2943cd20b…` (exit 0). The diff is
`git diff 54f2943cd...HEAD`.

Skeptic evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1464/evidence/skeptic-final-1/`. That
directory is the durable run dir, outside the worktree. I used my own headless Chromium, not the shared MCP browser, so
nothing was written to `.playwright-mcp/`.

### What I verified (with evidence)

**Diff read in full.** Production changes:
- 7 `useId()` label/Select associations.
- The D3a `htmlFor={noSourcesYet ? undefined : id}` in AddRootModal and CreatePipelineModal.
- The TableDisplayFields.css shrink rules moved from `@media (max-width: 768px)` into the base rules.
- `title={column.key}` on the column-key span.
- Two aria-label renames: "Scatter color by field" and "Histogram bins".

The CSS diff adds only `min-width: 0` and `minmax(0, 1fr)`, with no literal spacing, colour or type values. The
phone-only wrap, 44px expander and move-gap rules are untouched. There is no `eslint-disable` in the source diff.

**Whole-tree `htmlFor` sweep (AC2).**
- Every literal `htmlFor="…"` in non-test `.tsx` under `frontend/src` has a matching literal `id`.
- The first pass of my sweep flagged 6 ids. Re-running it with filenames showed every hit was in a `*.test.tsx`, e.g.
  `Select.test.tsx:94` `htmlFor="pos"`, which is test-local.
- None of the seven old literals (`add-root-source`, `divider-orientation`, `form-editor-dataset`, `image-fit`,
  `pipeline-source`, `schedule-kind`, `source-method`) remains as a selector in `frontend/src`, `e2e/` or CSS.
- The remaining hits are test comments and unrelated `pipeline-source` connector-ref keys in
  `unresolvedConnectorRefs*`, which are not DOM ids.
- So the switch to `useId` breaks no e2e or selector consumer. The old accessible names ("Scatter color-by", "Bin
  count") survive only in a deliberate negative assertion (`OutputEditorSheet.labels.test.tsx:246`, `queryByRole(...
  "Bin count").not.toBeInTheDocument()`). The e2e query at `hel1311…spec.ts` was updated to the exact new string.

**Gates, fresh in the worktree:**
- `npx jest --testPathPatterns=<the 10 touched component families>`: 22 suites and 258 tests passed, 18 snapshots.
- `npm --prefix frontend run lint`: exit 0 (`--max-warnings=0`).
- `npm --prefix frontend run typecheck`: exit 0.
- For the full suite and build I relied on the evaluator's pasted `eval-1/gate-*.txt`.

**Red first (C1).** I read the evaluator's `eval-1/red-on-base.txt` (base sources with HEAD's tests overlaid): 34
failed and 122 passed. Every failure name is one of the new HEL-1464 tests: seven label-association tests, the
uniqueness tests, the D3a tests, the 2.5.3 tests and sweeps, the title test and the four CSS-guard cases. The other
failures are the deliberately updated name/snapshot consumers. These are assertion failures, not compile failures.

**`TableDisplayFields.css.test.ts` is honestly labelled.** Its header reads: "source-text guard (NOT rendered evidence;
the running-app measurement … is the proof)". It names its mutation, and that mutation is red on the base CSS.
`files-modified.md` also calls it a "labelled guard". It is not presented as the causal proof.

**Live overflow measurement (AC1), from my own probe.** Throwaway user `hel1464-skeptic-1791759625052@example.test`,
id `4483df1c-94da-40b6-9987-ceaf8c0b7285`, recorded in `state.json` before any probe. Identity was checked against
`/api/auth/me` before every page load, and `href` was recorded with every reading. Fixtures were three table Outputs
with column names of:
- the ticket's own 49 chars (`customer_lifetime_value_adjusted_for_seasonality1`);
- my own wide-glyph 49 chars (`MW_WMQDHOAB…`);
- 86 chars.

I took 42 readings: light and dark × 1440/1100/1024/900/769/768/375 × 3 fixtures (`overflow.json`,
`overflow-run.log`). The results:
- **Containment.** In every reading the furthest-right non-absolute descendant of the table options sits at or inside
  the Configuration card's content-box right edge (`over: 0`, `underLeft: 0`).
- **No sideways scroll.** The sheet has `scrollWidth == clientWidth` (718/718 at ≥769, 335/335 at 375) and the
  document never scrolls sideways. The only horizontal scroller is the preview data table section, which scrolls by
  design.
- **HEL-469.** The name is never 0px (199–582px), the checkbox is 13px, and the format wrapper is 140px. `title`
  equals the full name in every reading.
- **Truncation.** At desktop the 86-char and wide-49 names ellipsize. The realistic 49-char name fits unellipsized at
  322px.

**On the ticket's "23–70px with a 49-char name".**
- I confirm it does not reproduce with the realistic name. At ≥769px the sheet is a fixed 718px, and that name needs
  only 322px.
- The executor's substitute (a wide-glyph 49) and the evaluator's in-browser re-gating mutation (+142px / +222px at
  1100, `eval-1/mutation-overflow.json`) show the defect class and its fix.
- AC1's literal requirement is containment with a 49-char and an 86-char name, and that holds for both 49s and the 86.
- The substitution is disclosed in `task-1.1-root-cause.md`, and I do not treat it as a gap.

**Visual judgment, from screenshots I viewed** (`shots/after-86-light-1100.png`, `after-86-dark-1440.png`,
`after-86-dark-375.png`, `after-86-light-768.png`, `labels-scatter-dark.png`):
- **Desktop row.** The name ellipsizes cleanly before the format select. The format selects and move groups stay
  column-aligned across rows. The recessed well and card padding are intact. The row shape is unchanged from the
  sibling rows.
- **Phone layout.** The ≤768 wrap is unchanged: the name on line 1, then the select and the 44px move group.
- **Themes.** Light and dark match.
- **Design.** No new UI, so there is nothing off-pattern. The native `title` tooltip follows DESIGN.md's established
  pattern for truncated text.

**Label-in-name across the Output editor (AC3), live in both themes** (`labels-light.json`, `labels-dark.json`,
`aria-scatter-*.txt`). For scatter, histogram and table, every `<label>` resolves to a control (`label.control`
non-null, so no dangling label). Every aria-labelled control's name contains its visible label text:

| Visible label    | Accessible name          |
| ---------------- | ------------------------ |
| Kind             | Output kind              |
| Chart type       | Chart type               |
| Point size field | Scatter point size field |
| Color by field   | Scatter color by field   |
| Field            | Histogram field          |
| Bins             | Histogram bins           |
| Cell density     | Cell density             |
| Keep each run's rows | Keep each run's rows |

The remaining controls (Name and the column checkboxes) take their name from the label. Outside the `<label>` set,
"Annotation" is named "Annotation field", which also contains its visible text.

**Console during the probes.** Two kinds of error appeared, and neither relates to this diff:
- 401 on `/login` before sign-in;
- 404s for unmaterialized-pipeline fetches.

**Seven non-Output-editor surfaces.** Each is covered by a rendered-DOM test that goes through the `<label>` element
(`frontend/src/test/labelAssociation.ts`). The chain is `htmlFor` non-empty, `getElementById` resolves to the
role-plus-name combobox, and `getByLabelText` returns the same control. Each surface also has a two-instance
uniqueness test. The evaluator's live keyboard and association readings (`eval-1/labels-*-all.json`) are consistent
with this, and I did not find anything contradicting it.

**Hygiene.**
- **Fixtures.** Every fixture was deleted by exact id: 5 outputs → 200, 3 pipelines → 204, 3 sources → 204. The user
  was deleted by id plus email through the e2e cleanup builder (`cleanup.log`).
- **Servers.** I started them with `start-servers.sh`, and `assert-phase.sh servers` passed. The process cwds were the
  worktree's `frontend/` and `backend/`.
- **Shutdown.** I stopped them by recorded PID (330508 330493 330251 329259 329217), and ports 6896 and 9803 are free
  (`server-pids.txt`).

**Gate defect check (mtime).** No mtime-ordering claim is load-bearing here. The red/green evidence is
assertion-output based, so there is no gate defect.

### Verdict: CONFIRM

### Non-blocking notes
- `TableDisplayFields.css.test.ts` matches CSS with regexes. A behaviour-preserving move into a grouped selector would
  turn it red falsely, and it cannot see an ancestor-caused overflow. If a durable regression test is wanted later, the
  real one is a Playwright containment check at 1100px with an 86-char column.
- The ticket's 23–70px/49-char figure does not reproduce on the current 718px sheet. This is worth noting on the
  ticket so the number is not chased later.
- Pre-existing and out of scope (evaluator finding, not re-litigated): the scatter size/color Select lists "— None —"
  twice and logs a duplicate React key `""`. A follow-up ticket is worthwhile.
