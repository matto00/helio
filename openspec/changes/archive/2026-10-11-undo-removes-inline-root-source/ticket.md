# HEL-1493: Owner decision: should patch-set UNDO of an inline-root pipeline create also remove the inline source?

## Description

origin_kind: followup
origin_ticket: HEL-1475

HEL-1475 item 4, deferred to the owner as a product call (not assumed overnight).

Today `PatchSetUndoService` handles `("pipeline","create")` via `restoreCreateUndo(... pipelineService.delete ...)`: undoing an applied pipeline-create whose root was an inline source deletes only the pipeline. The source the apply created stays in the user's source list, and so does the implicit "Auto:" Connector if the root was a bare-url REST spec.

**Question for the owner:** should undo also remove that source (and its implicit Connector)?

Options:

* **A, keep today's behaviour.** The source survives undo. This is safe: the user may have bound other things to it since the apply.
* **B, delete it only if unreferenced.** Delete the source via `DataSourceService.delete`, which already refuses with 409 while anything references it. Then delete the implicit Connector through the HEL-1475 `InlineSourceCleanup` helper. If the source is referenced, report it and keep it.
* **C, delete it only if unreferenced AND unmodified since the apply.** Same as B, but also skip deletion when rows or schema changed after the apply.

The HEL-1475 lane recommends **B**: undo means "as if this edit never happened", and the 409 guard already protects any source that is still in use. It is still an owner call.

## Acceptance Criteria

- The owner's decision (A/B/C) is recorded via the escalation mechanism before any behaviour is designed.
- The chosen behaviour is implemented (or, for A, pinned by a test and documented), with red-first tests.
- Prod cleanup of existing orphans is out of scope (HEL-1495).
