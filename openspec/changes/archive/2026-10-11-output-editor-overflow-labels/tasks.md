## Standing Constraints

- [C1] Red first: every new test is shown red on the whole pre-fix tree (non-test sources at the base SHA), then green.
- [C2] No new `eslint-disable`, no `--no-verify`/`HUSKY=0`/`core.hooksPath` override; design tokens only (DESIGN.md).
- [C3] Running-app verification uses a self-registered throwaway `@example.test` user (id recorded up front); verify
  the logged-in identity before each probe; never act as matt@helio.dev; delete fixtures by exact id only.
- [C4] Evidence and scratch files live under `/home/matt/Development/helio/.concertino/runs/HEL-1464/evidence/`,
  never the main checkout root or `/tmp`.

### Frontend

- [x] 1.1 Measure the desktop overflow (1100/1440, both themes, 49- and 86-char names) and record the root-cause element
- [x] 1.2 Make the TableDisplayFields shrink rules unconditional; keep the wrap layout width-gated (D1)
- [x] 1.3 Add `title={column.key}` to the column-key span (D2)
- [x] 1.4 AddRootModal and CreatePipelineModal: `useId()` id on Select + label `htmlFor` (D3)
- [x] 1.5 DividerEditor, FormEditor, ImageEditor: `useId()` id on Select + label `htmlFor` (D3)
- [x] 1.6 PipelineScheduleDialog and RestApiForm: `useId()` id on Select + label `htmlFor` (D3)
- [x] 1.7 ChartDisplayFields: color-by `ariaLabel` → "Scatter color by field"; update its consumers (D5)
- [x] 1.8 Audit every Output-editor label vs accessible name; HistogramBinCountField aria-label → "Histogram bins" (D5a)
- [x] 1.9 AddRootModal/CreatePipelineModal: no `htmlFor` when the Select is not rendered (D3a)

### Tests

- [x] 2.1 Label-element association test per label (seven sites) + instance-uniqueness tests (non-empty ids; record skips) (D6)
- [x] 2.6 D3a test: the "Data source" label has no `for` when no sources exist (AddRootModal, CreatePipelineModal)
- [x] 2.2 2.5.3 tests: color-by name contains "Color by field"; bins name contains "Bins"; update "Bin count" consumers
- [x] 2.3 Record red on the whole pre-fix tree, green after
- [x] 2.4 Re-run the literal `htmlFor` sweep; record that no dangling literal remains
- [x] 2.5 Running-app before/after evidence per D7 (375/768/1024/1100/1440, both themes, keyboard, accessible names)
