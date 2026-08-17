## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read all planning artifacts fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/nav-section-registry/spec.md`, and round 1's own report
  (`skeptic-design-1.md`) — treated the latter as a set of claims to re-check, not as ground truth.
- Re-read the real, current `frontend/src/app/App.tsx` in full (still 750 lines, unchanged since
  PR #382 — confirmed via `git log --oneline -3 -- frontend/src/app/App.tsx`, no commits since
  `c0fbb56a`) and cross-checked every line number design.md/tasks.md cite against it directly:
  `App.tsx:411-415` is exactly the registry pipeline-prefetch effect, `App.tsx:637-645` is exactly
  the sr-only `<h1>` block — both citations are accurate, not approximate.
- Re-confirmed CONTRIBUTING.md's exact file-size language (`grep -n "soft budget\|propose a
  split" CONTRIBUTING.md`): "Soft budgets: **~250 lines per source file**... If a file you're
  editing crosses ~400 lines, propose a split" — matches what design.md/proposal.md/tasks.md now
  cite verbatim.
- Read `frontend/src/shared/chrome/navDestinations.ts` (6 entries, `icon: LucideIcon` required,
  non-optional) and `SidebarBody.tsx`'s `sectionFromPathname` (confirmed the exact `PickerId` union
  and match ordering design.md's Decisions section describes) and `BottomNav.tsx` (confirms its
  import of `navDestinations` is untouched by the split, matching proposal.md's "import path only"
  claim).
- Ran `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`, and `openspec validate
  single-route-section-registry --strict` → `Change 'single-route-section-registry' is valid`.
- Independently reconstructed the post-split `App.tsx` line budget from the actual current source
  (not from design.md's own assertion) — see below.
- Confirmed no `TODO`/`TBD`/placeholder language remains anywhere in the five planning artifacts.

### Round-1 change requests — verified fixed, not just claimed fixed

**CR1 (AC3 line budget) — fixed with genuine additional extraction, not a threshold swap.**
`design.md`'s "App.tsx split boundary — four extractions, not one" (lines 68-109) adds
`AppRoutes.tsx` (the entire `<Routes>` tree + `NotFoundPage` + 17 page imports), moves undo/redo
ownership entirely into `CommandBar.tsx` (not drilled back as props), and moves the
`flushFnRef`/`registerFlush`/`flush`/`saveStateContextValue` glue into a new `useSaveStateRegistry()`
hook — on top of the original `CommandBar`/`Sidebar`/`MobileShell` split. I independently
reconstructed the resulting `App.tsx` from the real current source (imports 1-80, `breadcrumbLabel`
82-91 deleted, `NotFoundPage` 93-110 moved out, `AppShell` 112-697 minus everything design.md names
as moved, `App()` 699-750 shrunk per task 2.2's stated shape) and landed at roughly 290-300 lines —
materially better than round 1's own ~370-400 reconstruction (which lacked these three extractions),
and genuinely "credibly near" 250, not merely under the 400-line hard trigger by a slim margin.
Tasks.md task 2.7 explicitly instructs the executor to measure the real count and, if still above
~250, **state the actual final count and contents in the PR description "rather than silently
treating the ~400-line hard trigger as good enough"** — this is real transparency (visible,
reviewable, checkable at the final gate), not a redefinition-by-omission the way round 1's bare
parenthetical was. This satisfies round 1's CR1 on both prongs: (a) real additional extraction was
added, and (b) the fallback is explicit and honest rather than a quiet substitution.

**CR2 (zero-behavior-change contradiction) — fixed.** `design.md:26-32`'s Goals now reads "Zero
**unintended** behavior change" with an explicit, named exception: "/settings, /proposals/review,
/patch-sets/review currently mislabel themselves 'Dashboards'... this change intentionally fixes
that." `proposal.md:31`'s Non-goals mirrors this: "no unintended visual/behavioral changes to any
page (the one deliberate exception is the label fix above)." Both docs now carve out the exact
exception round 1 flagged, in the language round 1 suggested. No remaining unqualified "zero"/"no"
claim exists anywhere in either file (grepped both in full).

**CR3 (two missing call sites) — fixed at both the design and task level.** `design.md:18-22`'s
Goals bullet now names all four call sites `usePickerSelection` must replace, explicitly including
`App.tsx:411-415` (registry-prefetch effect) and `App.tsx:637-645` (sr-only heading). Critically,
`tasks.md` task 1.3 — the actual executable task, not just the design narrative — now lists the
same four call sites by name and line reference, and task 2.8 ("Remove now-dead code... once all
four call sites (task 1.3) have moved") explicitly cross-references task 1.3's four-item list rather
than the round-1 language of "once their callers have moved" with only two callers ever named. This
closes the dangling-reference risk round 1 raised.

Both round-1 non-blocking notes are also addressed: the `"dashboards"` `activeItemName: null`
asymmetry is now spelled out in `design.md:119-123` and `tasks.md:17-19`; `SectionEntry.icon`'s
required-when-`showInNav` typing is specified in `design.md:124-128` and `tasks.md:3-4` (a
discriminated union rather than a bare `icon?` + non-null assertion), correctly matching
`navDestinations.ts`'s real `icon: LucideIcon` (non-optional) field I re-verified above.

### New observation (non-blocking, not a round-1 regression)

`design.md`'s Goals (lines 18-22) fold the registry pipeline-prefetch *side effect*
(`App.tsx:411-415`) into `usePickerSelection`, and the Decisions section (lines 97-99) is explicit
that `AppShell`, `CommandBar`, and `MobileShell` **each independently call `usePickerSelection`**
rather than receiving a prop-drilled result (design.md: "Each extracted component calls
usePickerSelection/useLocation/useAppSelector itself"). `AppShell` also needs the hook's output
itself, since design.md keeps the `document.title` effect and (by omission — it's not in the
`CommandBar`/`Sidebar`/`MobileShell`-extracted-markup list) the sr-only `<h1>` heading inside
`AppShell`'s `<main>`. That means the hook's internal `dispatch(fetchPipelines())` prefetch effect
now has three independent instances (one per calling component) instead of today's single call site
in `AppShell`. Because each instance's `pipelines.status` is a value captured from that component's
own render pass (not re-read live inside the effect), all three renders can see `"idle"`
simultaneously on first mount/first navigation to `/registry`, before any of the three effects has
had a chance to dispatch and flip the store — so on that one narrow window (first-ever visit to
`/registry` in a session), this can plausibly fire 2-3 redundant `GET /api/pipelines` calls, on top
of `SidebarBody`'s own pre-existing separate registry-section fetch, which the current code's own
comment says the single-instance idle-gate was specifically written to avoid racing
(`App.tsx:407-410`: "status-gated so a sidebar-driven fetch and this one don't loop"). This is
idempotent (GETs, no data corruption, final state converges) and narrow (fires at most once per
session), so I'm not treating it as blocking — but design.md's otherwise-thorough Risks section
(which already names two adjacent stale-closure/re-render risks in this exact refactor) doesn't
mention it. Worth a one-line addition before/during execution: either state explicitly that this
redundancy is accepted as harmless, or have the prefetch dispatch live in exactly one owner (e.g.
kept in `AppShell` only, decoupled from the parts of `usePickerSelection` that `CommandBar`/
`MobileShell` need) so the "one implementation" guarantee doesn't silently become "one implementation,
N simultaneous instances."

### Verdict: CONFIRM

All three round-1 change requests are genuinely fixed — not renamed, not buried, not merely
asserted. CR1 in particular was the substantive one (an unsatisfiable AC as scoped), and the
revision adds real extraction that I independently verified moves the needle from ~370-400 lines to
~290-300, backed by an honest, checkable fallback if reality still falls short. CR2 and CR3 are
clean, complete fixes. The registry/hook architecture remains sound and well-grounded in the real
codebase (as round 1 already found). The plan is sound enough to implement.

### Non-blocking notes

- The `usePickerSelection` multi-instance prefetch-effect redundancy above — cheap to close off
  explicitly before/during execution, not a reason to hold up the design.
- `proposal.md`'s Impact list still lists `BottomNav.tsx (import path only)` — on inspection this
  file needs literally zero changes (it imports `navDestinations` from the same relative path,
  which the split preserves per task 1.2), so this line is conservative-but-harmless, not
  inaccurate. No action needed.

### Environmental note (not part of the verdict)

This worktree's `scripts/concertino/` (gitignored, generated by `concertino sync`) only contains
`assert-phase.sh`, `cleanup.sh`, `README.md`, `setup-worktree.sh`, `start-servers.sh`,
`.concertino.env` — it is missing `next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`,
and several others present in the main checkout's `scripts/concertino/`. I did not guess a fallback
report filename; I invoked the main checkout's copies of `next-report-number.sh`/
`persist-evidence.sh` by absolute path instead, since both are self-contained (they resolve the main
checkout via `git rev-parse --git-common-dir`, not via their own file location — `emit-event.sh`'s
own header documents this exact fallback as the intended pattern for scripts invoked from inside a
worktree). Worth fixing the worktree-bootstrap step so future rounds in this worktree don't need
the same workaround.
