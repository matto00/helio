## ADDED Requirements

### Requirement: Every panel create stores a valid layout item at every breakpoint

Every server path that creates a panel on a dashboard SHALL, in the same transaction as the panel insert, store one
layout item for the new panel in each of `lg`, `md`, `sm` and `xs`. This applies to:
- single create of any kind (`output`, `text`, `markdown`, `image`, `divider`, `form`);
- every item of a batch create;
- panel duplicate;
- proposal apply and contents replace, including a panel with no authored placement.

Each item SHALL be placed at `x = 0`, below the lowest stored item of that breakpoint or below items placed earlier in
the same request. Sizes:
- An `output` panel SHALL use its Output kind's default size, scaled to the breakpoint's column count as before.
- A `text`, `markdown`, `image`, `divider` or `form` panel SHALL be `5` rows high, at width `4` at `lg`, `4` at `md`,
  `3` at `sm` and `2` at `xs`. This is the size the client renders an unplaced panel at. An `output` panel whose
  Output cannot be resolved SHALL take the same size.
- A duplicated panel SHALL be sized per `panel-duplication` (source stored size, else scaled source `lg`, else the
  kind default above).

After the write:
- A breakpoint that was valid before the create SHALL be valid under the HEL-1071 contract.
- A breakpoint that was stored-bad SHALL keep its existing items unchanged and gain an item that overlaps none of them.

Two concurrent creates on the same dashboard SHALL both end up stored; neither placement may be lost.

Dashboard duplicate and dashboard import are copies, not panel creates. They SHALL keep copying the source or snapshot
layout as already specified. A panel they carry without an item is left to the owner's stored-layout repair
(`stored-layout-repair`).

#### Scenario: Text panel create stores an item per breakpoint
- **WHEN** the owner creates a `text` panel on a dashboard whose stored layout is empty
- **THEN** the stored `lg`, `md`, `sm` and `xs` each hold exactly one item for that panel, and each breakpoint is valid

#### Scenario: Content panel default size per breakpoint
- **WHEN** a `text` panel is created on a dashboard with an empty layout
- **THEN** its stored items are `w 4 h 5` at `lg`, `w 4 h 5` at `md`, `w 3 h 5` at `sm` and `w 2 h 5` at `xs`, all at
  `x 0, y 0`

#### Scenario: Every kind is placed
- **WHEN** a panel of each kind `output`, `text`, `markdown`, `image`, `divider` and `form` is created on one dashboard
- **THEN** every created panel has an item in every stored breakpoint and no two items overlap in any breakpoint

#### Scenario: Created item passes the layout write validator
- **WHEN** a client takes the stored layout after a create and sends every breakpoint back unchanged in a layout PATCH
- **THEN** the PATCH is accepted with `200`

#### Scenario: Concurrent creates both persist
- **WHEN** two panels are created on the same dashboard concurrently
- **THEN** the stored layout holds an item for both panels in every breakpoint, and no two items overlap

#### Scenario: Editor grantee create is placed under row-level security
- **WHEN** a user holding an editor grant creates a panel while the database enforces row-level security for the
  application role
- **THEN** the panel and its item in every breakpoint are stored

#### Scenario: Proposal panel without an authored placement is placed
- **WHEN** a proposal is applied in which one panel has an authored `lg` placement and another has none
- **THEN** both panels have an item in every stored breakpoint, the authored one keeps its `lg` placement, and every
  breakpoint is valid

#### Scenario: Duplicated dashboard keeps an orphan for the owner repair
- **WHEN** a dashboard holding a panel with no stored item is duplicated or exported and imported
- **THEN** the new dashboard's stored layout for its other panels is copied as specified, and the owner repair
  endpoint accepts the orphan appended to it with every prior item unchanged
