## 1. Design artifacts

- [x] 1.1 Write `proposal.md` — why, what changes, capabilities (none — design-only), impact
- [x] 1.2 Research existing codebase precedents (`PipelineRunRegistry`, `overwriteRows`,
      `resolveBindingsForRead`, `/api/types/:id/rows` ACL, `markDataTypeRowsStale`,
      `usePipelineRunEvents`, `resource_permissions` sharing table) and ground every design
      decision in the actual files/patterns found
- [x] 1.3 Write `design.md` — context (including correcting the ticket's stale ACL-asymmetry
      premise), decisions (D1 BroadcastChannel now, D2 scoped SSE registry, D3 defer C/D),
      risks/trade-offs, open questions

## 2. Recommendation and cost estimates

- [x] 2.1 Recommendation: hybrid — ship candidate B (BroadcastChannel, cross-tab) now as a small
      standalone spinoff; recommend candidate A (SSE `DataTypeRowRegistry`, scoped to owner-only
      ACL) as a second spinoff for the future-row-writer gap and the owning-user's cross-session
      gap; defer C (polling) and D (service-worker push)
- [x] 2.2 Cost estimates captured in `design.md` Decisions/Risks (B: ~30 LOC frontend-only,
      low risk; A: new many-to-one registry — materially more than a `PipelineRunRegistry`
      copy — plus disconnect-lifecycle tests, scoped client hook, and a publish-ordering fix in
      `PipelineRunService.onRunSuccess`)

## 3. Spinoff tickets

- [x] 3.1 File Linear ticket: "Cross-tab panel invalidation via BroadcastChannel" (candidate B,
      small, no ACL changes) — filed as **HEL-640**, linked to HEL-266
- [x] 3.2 File Linear ticket: "DataTypeId-keyed SSE broadcast for panel row invalidation"
      (candidate A, scoped to owner-only subscriptions, chokepoint at `overwriteRows`,
      many-to-one registry with disconnect-driven cleanup) — filed as **HEL-641**, linked to
      HEL-266
- [x] 3.3 File Linear ticket (or note as a follow-up question, per design.md Open Questions):
      "Should DataType access become sharing-aware?" — separate from and prerequisite to a
      *complete* fix for the cross-user gap; not scoped as part of 3.2 — filed as **HEL-642**,
      explicitly marked as independent of / prerequisite to HEL-641 (not required scope for it),
      linked to HEL-266
