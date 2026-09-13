# pipeline-cycle-detection Specification

## Purpose
Prevents a pipeline write/read graph from containing a cycle — a pipeline that writes,
directly or transitively through other pipelines, back into a source it reads — which would
loop forever at run time; rejects such a graph at validation time instead.

## Requirements

### Requirement: Direct cycle rejected at validation time
The system SHALL reject, at validation time, a pipeline whose write target (an `upsertsource`
step's `existingSource` target) names a data source the same pipeline also reads (directly via
a root, or transitively via any other pipeline in the caller's visible graph). The rejection
response SHALL name the cycle (the data sources and pipelines forming it).

#### Scenario: A pipeline writes to a source it directly reads
- **WHEN** a pipeline that reads data source `S` is given (or already has) an `upsertsource`
  step whose target is the existing source `S`
- **THEN** the write is rejected with a message naming pipeline and source `S` as the cycle

### Requirement: Transitive cycle across pipelines rejected at validation time
The system SHALL reject a write that would create a cycle spanning more than one pipeline,
including but not limited to a two-pipeline cycle (pipeline A writes the source pipeline B
reads; pipeline B writes the source pipeline A reads) and longer chains (three or more
pipelines).

#### Scenario: Two-pipeline transitive cycle
- **WHEN** pipeline A reads source `S1` and writes source `S2`, and pipeline B reads source
  `S2` and is being given a write target of source `S1`
- **THEN** the write for pipeline B is rejected with a message naming the cycle `S1 -> A -> S2
  -> B -> S1`

#### Scenario: Three-pipeline transitive cycle
- **WHEN** pipeline A reads `S1` writes `S2`, pipeline B reads `S2` writes `S3`, and pipeline C
  reads `S3` is being given a write target of `S1`
- **THEN** the write for pipeline C is rejected, naming the full cycle

#### Scenario: A non-cyclic diamond is accepted
- **WHEN** pipeline A reads `S1` and writes `S2`; pipeline B reads `S1` and writes `S3`;
  pipeline C reads both `S2` and `S3` and writes `S4` (no path leads back to `S1`, `S2`, or
  `S3`); note `S4` is reachable from `S1` by two distinct paths (via `S2` and via `S3`), so a
  detector that flags any already-visited node — rather than only a node still on the current
  DFS path — would wrongly report a cycle here
- **THEN** none of these writes are rejected as a cycle

### Requirement: Cycle graph is scoped to the caller's own visible resources
The system SHALL build the read/write dependency graph used for cycle detection only from
pipelines and data sources visible to the requesting caller (owned or shared with them). The
rejection message SHALL NOT name a pipeline or data source the caller cannot see.

#### Scenario: A cycle passing through another tenant's private pipeline is not detectable as a cycle by this caller
- **WHEN** the graph needed to prove a cycle would require a pipeline or source the caller
  cannot see
- **THEN** the write is evaluated only against the caller's own visible graph and is not
  rejected on the basis of resources outside it

### Requirement: Every edge-adding write path is checked
The system SHALL run cycle detection on every operation that can add or change a read or write
edge in the pipeline graph: creating a pipeline (with its roots and steps), adding a root to an
existing pipeline, adding an `upsertsource` step, and updating an `upsertsource` step's target.
An operation that can only remove an edge (removing a root, deleting a step) SHALL NOT require
this check, since it cannot introduce a new cycle.

#### Scenario: Creating a pipeline whose roots close an existing writer-chain cycle is rejected
- **WHEN** a pipeline is created with a root reading source `S`, and a different, already-persisted
  pipeline writes to `S` such that the new pipeline's own downstream write target would complete a
  cycle back to `S`
- **THEN** the create request is rejected, naming the cycle
- **Note:** a same-request self-cycle (one create request carrying both the reading root AND an
  `upsertsource` step writing the same source) cannot be exercised through the live API until
  `upsertsource` is registered (HEL-1100) — the underlying check is proven via the validator unit
  tests in task 2.1, and HEL-1100 owns the corresponding end-to-end test once registration lands
  (tracked via a comment on HEL-1100)

#### Scenario: Adding a root to an existing writer pipeline is rejected if it closes a cycle
- **WHEN** a pipeline already writes source `S2` and a root is added to it reading a source
  that source `S2`'s own writer-chain leads back to
- **THEN** the add-root request is rejected, naming the cycle

### Requirement: An editor grantee's write is checked against their own visible graph
The system SHALL check a write made by a non-owner editor grantee against the graph visible to
that editor (owner-or-shared visibility, the same scope existing sharing-aware read paths use),
and SHALL NOT reveal, in the rejection message or otherwise, a pipeline or data source that
editor cannot see, even if a genuine cycle exists only when a resource outside their visibility
is included.

#### Scenario: An editor grantee's write that would close a cycle within their own visible graph is rejected
- **WHEN** an editor grantee (not the pipeline owner) submits a write that, considering only the
  pipelines and sources visible to that editor, would close a cycle
- **THEN** the write is rejected, naming only pipelines/sources visible to that editor

### Requirement: Concurrent edge-adding writes are serialized
The system SHALL prevent two concurrent edge-adding writes — whether by the same owner, or by an
owner and an editor grantee, or by two different editor grantees of pipelines that together would
close a cycle — from each passing validation independently and together forming a cycle neither
write alone would have created.

#### Scenario: Two simultaneous writes that would jointly form a cycle
- **WHEN** two edge-adding writes are submitted at effectively the same time, and together (but
  not individually) they would close a cycle
- **THEN** the writes are serialized so the second one to actually commit is validated against
  a graph that already includes the first, and is rejected if it closes a cycle
