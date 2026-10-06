## REMOVED Requirements

### Requirement: Undo SHALL refuse the whole undo with a typed error when a needed Output repository is unavailable
**Reason:** the Output repository is now required (HEL-1295) and `PatchSetUndoContext` / `PatchSetApplyContext` assert it
non-null at construction, so the state this requirement guards ("a needed Output repository is not configured") can no
longer occur; the `needsOutputRepo` pre-check and `Output repository is not configured` error were deleted with it. All
three scenarios (lane-delete refused, lane-create refused, repo-free application undoes normally) described that
unreachable state.
**Migration:** none. Constructing the undo or apply service with a null Output repository now fails fast with an
`IllegalArgumentException` at construction (pinned by `OutputRepositoryRequiredSpec`); an application that never needs the
repository undoes exactly as before.
