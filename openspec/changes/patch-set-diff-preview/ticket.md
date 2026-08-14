# HEL-408: Diff / impact preview before applying a patch set

## Description

Before a user accepts a conversational refinement, they should see exactly what will change and
on which resources — the mutation analogue of the create-only `ProposalReview` UI
(`ProposalReview.tsx`), which shows a proposed dashboard's panels + a preview before Accept. A
patch set (HEL-343 schema ticket) edits *existing* resources, so the preview must be a
before/after diff + an impact summary (e.g. "3 panels changed, 1 removed; pipeline X will need a
re-run").

This ticket adds a diff/impact preview: a backend dry-diff that computes before/after per edit
without writing, and a frontend review surface reusing the `ProposalReview` visual patterns.

Touches: a backend dry-diff service method (reuse the patch-set pre-validation + prior-state
capture from the apply ticket, but compute-only), a preview route (e.g.
`POST /api/patch-sets/preview`), and a frontend review component alongside `ProposalReview.tsx`.

## Scope

* Backend Scala: a `preview(patchSet, user)` that resolves each target under RLS and computes the
  projected after-state per edit WITHOUT writing, returning
  `[{ target, op, before, after, impact }]`. Reuse the apply ticket's pre-validation so preview
  and apply agree on validity. No fully-qualified names inline.
* Impact hints: flag downstream effects a user should know about (e.g. a pipeline/step edit means
  the output DataType's rows are stale until re-run; a panel unbind).
* Backend Scala: `POST /api/patch-sets/preview` returning the diff. Read-only, no writes.
* Frontend TS/React: a patch-set review surface (reuse `ProposalReview` layout/patterns +
  `InlineError`) showing per-resource before/after + impact, with Accept (→ apply endpoint) /
  Reject. Follow `DESIGN.md`.
* Tests: ScalaTest that preview computes correct before/after for update/delete/create edits and
  writes nothing; Jest/RTL for the review surface rendering a diff and routing Accept to apply.

## Acceptance Criteria

- [ ] `POST /api/patch-sets/preview` returns a per-edit before/after diff + impact hints, writing
      nothing (verified).
- [ ] Preview and apply share pre-validation, so a preview-clean patch set applies cleanly (and
      vice versa).
- [ ] Impact hints surface stale-rows / unbind / re-run consequences.
- [ ] The frontend review surface reuses `ProposalReview` patterns; Accept routes to the
      patch-set apply endpoint; nothing is written until Accept.
- [ ] `sbt test` + `npm test` + lint/format green; UI follows `DESIGN.md`.
- [ ] Backward-compat: additive endpoint + component.

## Out of Scope

* The apply + rollback primitive (sibling ticket, HEL-406, merged) and undo (sibling ticket).
* NL authoring of the patch set (multi-turn refinement ticket).

## Dependencies

* Depends on the HEL-343 patch-set schema (HEL-403, merged) + apply (HEL-406, merged) tickets —
  shares pre-validation/prior-state. Related to the HEL-343 multi-turn refinement ticket (which
  surfaces this preview in chat).
