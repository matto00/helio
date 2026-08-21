# HEL-535: Toast / notification system consistency pass

## Description

Toasts exist as a shared primitive (`shared/ui/Toast.tsx`, `ToastViewport` mounted in `App.tsx:247`) fed by
`features/toasts/` (`toastsSlice`, `toastListeners`, `useToast`) with intents info/success/warning/error. `DESIGN.md` §7
says toasts are transient bottom-right feedback (~4s auto-dismiss) and "not a substitute for inline error/empty states."
Usage has drifted: durations/intents are applied inconsistently, multiple toasts stack without bound, announcement is
uniformly assertive, and several mutation failures give no feedback at all.

**RE-SCOPED during planning (2026-08-20).** The original ticket bundled two kinds of work: toast **mechanics**, which is
mechanically verifiable, and a whole-app **toast-versus-inline policy audit**. Three design-gate rounds each refuted a
confidently-stated premise about existing surfaces in the hand-enumerated audit — most decisively, that the inline
surfaces which would replace removed toasts are announced (they are not: `InlineError.tsx:99`'s default renders a bare
`<p>` with no `role="alert"`, pinned by `InlineError.test.tsx:17`). The policy half was therefore split to **HEL-771**,
which restarts it with mechanical derivation from the `createAsyncThunk` registry as its premise. **This ticket now
delivers the mechanics half only**, and deliberately removes no toast that is a failure's only report.

## Scope (as delivered)

* Bound the stack: a concurrent-toast cap with oldest-first eviction, an exemption so a sticky action-bearing toast is
  never destroyed without user action, and coalescing of an identical repeated message.
* Fix announcement: always-mounted visually-hidden polite and assertive live regions, with each toast's message routed
  by intent, replacing today's uniformly-assertive per-node region (§8).
* Fix the surface (§7/§6/§3): §3's entrance token, an explicit `prefers-reduced-motion` opt-out, the 44px mobile tap
  floor on the dismiss control, and a viewport offset clearing the phone navigation bar.
* One auto-dismiss default (~4s), owned by the slice and applied at creation.
* Close six swallowed failures — `updateDashboardLayout`, `updatePanelsBatch`, `updatePanelColumnWidths`,
  `savePipelineSchedule` (header toggle), `deletePipelineStep`, `deleteMetric` — by adding the missing error toast,
  plus the success toast for `deleteMetric` that its three sibling delete affordances already have.
* De-duplicate the add-source flow so one button produces one toast with one wording across all seven of its paths.

## Acceptance criteria

* No failure in the six named paths is left reported nowhere; each emits exactly one error toast.
* One user action produces at most one toast per outcome, with identical wording regardless of internal code path.
* The auto-dismiss default and the concurrent-toast cap are uniform; stacked toasts behave predictably; a sticky
  action-bearing toast is never evicted.
* `aria-live` semantics are correct by intent (polite for non-error, assertive for error), via live regions that exist
  before their content; **net announcement coverage does not regress** — nothing announced today becomes unannounced.
* Toast surface matches tokens/§7; reduced motion genuinely disables the entrance and exit rather than shortening them;
  the stack never covers the phone navigation bar.
* Tests cover the cap, the eviction exemption, coalescing, live-region routing, and each newly-reported failure;
  `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* **The toast-versus-inline policy audit — HEL-771.** No toast that is a failure's only report is removed here, and no
  existing failure path's announcement posture is altered.
* `PanelList.tsx` and the `createDashboard.rejected` toast/inline collision — **HEL-770**; that file is out of bounds
  entirely (it is mid-rewrite in HEL-528's parallel run).
* A new notification center/history.
* Inline error component work — HEL-539, merged; consume it, do not redesign it.
* Skeleton/loading render branches — HEL-528, live in parallel.
* Empty-state CTA copy — HEL-548.

## Dependencies

HEL-539 (error-state components) is MERGED as PR #406 (squash `3d93e82a`); archived artifacts at
`openspec/changes/archive/2026-08-20-error-state-components/`.

## Parallel-run fence (binding for this run)

HEL-528 (skeleton loaders) is executing concurrently in its own worktree and owns render-branch ladders in panel/list/
detail views, including `PanelList.tsx` (~97 insertions / 46 deletions uncommitted, all three `EmptyState` blocks
relocated). Do not edit that file, any loading branch, any skeleton, or any panel/list/detail render ladder.
