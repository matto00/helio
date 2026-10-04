## MODIFIED Requirements

### Requirement: Teardown refuses when a tagged resource has a dependent outside this batch
The teardown call SHALL be refused in its entirety — no resource deleted — when a tagged data source is referenced
by any resource that this teardown would not delete. References are the same kinds the data-source delete guard
counts (pipeline root, join/lookup/union secondary input, upsert target, form panel binding). A reference is exempt
only when the referencing pipeline, or the referencing form panel's dashboard, is itself deleted by this same call
(owned by the caller and tagged with the tag being torn down). The check SHALL see referencing resources the caller
cannot see under row-level security; such a resource SHALL still block the teardown but SHALL NOT be named or
identified in the response. The response SHALL list each blocking conflict (the blocked resource, its kind, and the
out-of-batch dependents causing the block, named only when visible to the caller).

#### Scenario: Tagged data source with an untagged dependent pipeline blocks the whole call
- **WHEN** a data source tagged `T` has a dependent pipeline that is NOT tagged `T` (the
  dependent pipeline carries no tag at all), and `POST /api/workspace/teardown {tag: "T"}` is
  called
- **THEN** no resource tagged `T` is deleted, and the response reports the data source as
  blocked by the untagged pipeline

#### Scenario: Tagged data source with a differently-tagged dependent pipeline blocks the whole call
- **WHEN** a data source tagged `T` has a dependent pipeline tagged `U` (a different, live tag
  batch, not untagged), and `POST /api/workspace/teardown {tag: "T"}` is called
- **THEN** no resource tagged `T` is deleted, the `U`-tagged pipeline is left completely
  untouched, and the response reports the data source as blocked by that pipeline

#### Scenario: Tagging the dependent resolves the block
- **WHEN** the previously out-of-batch dependent pipeline is also tagged `T` and teardown is
  retried
- **THEN** the teardown succeeds and deletes the full tagged set including the pipeline

#### Scenario: A config reference from outside the batch blocks the call
- **WHEN** a data source tagged `T` is the secondary input of a join in an untagged pipeline, or is bound by a form
  panel on an untagged dashboard
- **THEN** no resource tagged `T` is deleted and the data source is reported as blocked

#### Scenario: A dependent the caller cannot see still blocks, unnamed
- **WHEN** a data source tagged `T` and owned by the caller is a root or secondary input of a pipeline owned by another
  user on which the caller holds no grant
- **THEN** no resource is deleted, the data source is reported as blocked, and the other user's pipeline id and name
  appear nowhere in the response

#### Scenario: Another user's identically tagged pipeline is not exempt
- **WHEN** the dependent pipeline is tagged `T` but owned by another user
- **THEN** the teardown is still refused, because that pipeline is not deleted by this call

#### Scenario: Existing per-DataType delete guards still apply
- **WHEN** a DataType tagged `T` is bound to a caller-owned panel, or is still the linked
  auto-inferred schema of a data source that is NOT tagged `T` (untagged or differently tagged)
- **THEN** teardown is refused with that DataType reported as blocked, matching the same
  conflict reasons `DELETE /api/types/:id` already returns for these cases

#### Scenario: A tagged data source and its own tagged companion DataType are torn down together
- **WHEN** a data source tagged `T` has an auto-inferred companion DataType also tagged `T`
  (the default shape produced by every data-source create path), and
  `POST /api/workspace/teardown {tag: "T"}` is called
- **THEN** the source-link guard does not block on this pairing — both the data source and its
  companion DataType are deleted in the same call


### Requirement: Teardown is owner-scoped
Teardown SHALL only ever delete and count resources owned by the calling user. A foreign-owned resource carrying the
same tag value SHALL never be deleted or counted, regardless of the RLS session context being correctly established,
and SHALL never be reported merely because it carries the tag. The one exception to "never reported" is the dependent
requirement above: a foreign-owned resource that references one of the caller's tagged data sources is an
out-of-batch dependent and blocks the teardown, named only when visible to the caller and otherwise reported as an
unnamed count.

#### Scenario: Foreign-owned resource with a matching tag is untouched
- **WHEN** user A calls `POST /api/workspace/teardown {tag: "T"}` and user B (not A) owns a
  data source, pipeline, or DataType also tagged `T`, none of which references a data source of user A tagged `T`
- **THEN** user B's resource is not deleted, not counted, and not reported as a conflict — the
  response reflects only user A's owned resources tagged `T`

#### Scenario: Owner-scoping holds even when user A owns nothing with the tag
- **WHEN** user A calls `POST /api/workspace/teardown {tag: "T"}`, user A owns no resource
  tagged `T`, but user B owns several
- **THEN** the call succeeds with all-zero counts; user B's resources are unaffected

#### Scenario: A foreign-owned dependent blocks but is never deleted or counted
- **WHEN** user B's pipeline tagged `T` references user A's data source tagged `T`, and user A calls teardown for `T`
- **THEN** the call is refused, user B's pipeline is not deleted or counted, and it is named only if user A can see it
