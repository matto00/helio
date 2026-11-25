## MODIFIED Requirements

### Requirement: A denied write surfaces a toast naming the specific denying rule
When a dataset write's response includes one or more denied downstream pipelines, the frontend
SHALL push exactly one toast for that write. Its message SHALL name, for each denied pipeline, a
specific rule-derived sentence drawn from a rule-code-to-copy mapping covering every
`CostReason.code` the estimator can produce (`ai-step`, `writeback-step`, `content-conversion`,
`unclassified-op`, `remote-fetch`, `unclassified-source`, `no-roots`, `row-estimate-unavailable`,
`rows-above-threshold`, `steps-above-bound`) — never a single generic "couldn't update" message.
When exactly one pipeline was denied and the response's `canRun` for it is true, the toast SHALL
carry a "Run to update" action; when exactly one pipeline was denied and `canRun` is false, the
toast SHALL carry no action. When two or more pipelines were denied, the toast SHALL list every
denied pipeline (none truncated) as a row whose pipeline name is a link to that pipeline's page
(`/pipelines/<id>`), followed by that pipeline's reason text; each row whose pipeline the writer
`canRun` SHALL also carry its own "Run to update" action that runs only that pipeline, and a row
whose `canRun` is false SHALL carry the link but no run action. Activating a row's "Run to update"
SHALL remove that row's action, and when no row action remains the toast SHALL be dismissed. When
the rows exceed the toast's maximum height they SHALL scroll inside the toast, and while rows remain
below the visible area the list SHALL show a bottom-edge fade cue drawn in the toast surface color;
a list that fits SHALL show no cue. The rows SHALL be ordered by pipeline name (English, numeric-aware
collation) with the pipeline id as the tie-break, and the toast message SHALL list the pipelines in that same
order. At phone width the first row SHALL line up with the variant icon as a single-message toast's
text does. A toast carrying an
action or a pipeline link SHALL NOT auto-dismiss.

#### Scenario: A single AI-step denial shows specific copy and a run action
- **WHEN** a form submit's response denies exactly one downstream pipeline with reason code
  `ai-step`, and the caller `canRun` for that pipeline
- **THEN** a toast is shown whose message names that the pipeline calls AI (not a generic message),
  carrying a "Run to update" action, and the toast does not auto-dismiss

#### Scenario: An unclassifiable-op denial gets honest, non-generic copy
- **WHEN** a form submit's response denies a pipeline with reason code `unclassified-op`
- **THEN** the toast names the unrecognized step rather than a generic "something went wrong"
  message

#### Scenario: Multiple denied pipelines from one write produce one toast, no action
- **WHEN** a form submit's response denies two different downstream pipelines with different
  reasons, and `canRun` is false for both (the writer holds only viewer grants on them)
- **THEN** exactly one toast is shown listing both pipelines' specific reasons, each pipeline's
  name is a link to its own pipeline page, the toast carries no "Run to update" action, and the
  toast does not auto-dismiss

#### Scenario: Each runnable pipeline in a multi-denial toast gets its own run action
- **WHEN** a form submit's response denies two pipelines, the writer `canRun` the first and not
  the second
- **THEN** the first pipeline's row carries a "Run to update" action that submits a run of that
  pipeline only, and the second pipeline's row carries a link but no run action

#### Scenario: Using every row action dismisses the multi-denial toast
- **WHEN** the user activates "Run to update" on a row of a multi-denial toast
- **THEN** that row no longer offers the action, the other rows are unchanged, and once no row
  action remains the toast is dismissed

#### Scenario: Rapid repeated writes with an identical denial do not stack toasts
- **WHEN** several dataset writes in quick succession each deny the same pipeline or the same set
  of pipelines for the same reasons
- **THEN** toast state holds exactly one toast for that denial, not one per write

#### Scenario: A viewer without run permission sees the reason but no action
- **WHEN** a form submit's response denies exactly one pipeline and `canRun` is false for the
  submitting user
- **THEN** the toast names the specific denying rule but carries no "Run to update" action

#### Scenario: A write denying only pipelines the writer cannot see produces no toast
- **WHEN** a form submit's response has no entries in `deniedPipelines` (every denied downstream
  pipeline was omitted server-side because the writer has no grant on any of them)
- **THEN** no denial toast is shown for that write

#### Scenario: Multi-denial rows are ordered by pipeline name, then id
- **WHEN** a write denies pipelines named "Zeta", "alpha" and "Beta" whose ids sort in a different
  order, and two further pipelines share the name "Gamma"
- **THEN** the rows render as alpha, Beta, Gamma, Gamma, Zeta, the two "Gamma" rows are ordered by
  pipeline id, Tab reaches the rows in that rendered order, and the toast message lists the
  pipelines in that same order

#### Scenario: The same denial set in any input order coalesces into one toast
- **WHEN** two writes deny the same pipelines for the same reasons but the response lists them in
  different orders
- **THEN** both builds produce a byte-identical message and toast state holds exactly one toast

#### Scenario: The first row lines up with the icon at phone width
- **WHEN** a multi-denial toast is shown at 390px width in either theme
- **THEN** the first row's link text sits at the same vertical offset from the variant icon as a
  single-message toast's text does, within 1px, every link and action keeps its 44px touch extent,
  and no row content paints at or above the toast's top border in any scroll position

#### Scenario: An overflowing row list shows a cue that more rows are below
- **WHEN** a multi-denial toast's rows exceed the list's maximum height and the list is not
  scrolled to its end
- **THEN** a bottom-edge fade in the toast's surface color is shown over the list, and it is gone
  once the list is scrolled to its end

#### Scenario: A row list that fits shows no overflow cue
- **WHEN** a multi-denial toast's rows fit within the list's maximum height
- **THEN** no overflow fade is shown
