# Services Layer

Business logic and orchestration, split by domain (`services/<domain>/`).
`ServiceError.scala` stays at this root — it is the intentionally small,
closed error type every domain's services return; see its own doc comment.

No other file lives directly in `services/` — every service belongs under
one of the 13 domain subdirectories (`alerts`, `auth`, `dashboards`,
`panels`, `pipelines`, `sources`, `workspace`, `hooks`, `metrics`,
`assistant`, `agents`, `proposals`, `patchsets`). See each subdirectory's own
README for what belongs there.

Splitting by domain does not create encapsulation: many members across this
tree are `private[services]`, which stays reachable from every domain
subpackage (e.g. a `private[services]` member of `services.dashboards` is
still visible from `services.pipelines`) — Scala's qualified-private access
follows the enclosing `services` package, not the domain split.
