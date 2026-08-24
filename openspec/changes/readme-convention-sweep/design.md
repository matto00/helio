## Context

HEL-632's epic repackaged the backend into domain subpackages (HEL-633), mirrored the test tree
(HEL-634), and grouped `schemas/` by domain (HEL-636). Each sibling wrote READMEs for the
directories it created, but no ticket swept the whole tree for gaps. This ticket is that sweep —
docs only, last leaf of the epic.

Re-enumerated against the live tree at `7cfb1e84` (not the ticket's original 2026-07-27
inventory, which is stale — see `ticket.md`'s CORRECTED note and the persisted
`premise-validation.md`).

## Goals / Non-Goals

**Goals:**
- Every in-scope directory (6 backend package gaps, 14 frontend feature dirs, 4 frontend shared
  dirs, 4 top-level tooling/doc dirs, the `schemas/` domain-subdir question) has an accurate
  README verified against the directory's real contents.
- The "does not belong here" line resolves genuine ambiguity (frontend shared-dir vs.
  feature-local equivalent) from actual code usage, not guesswork.

**Non-Goals:**
- No code, config, or migration changes.
- No README for a directory the epic hasn't produced (e.g. HEL-802/803/804/811 follow-ups are
  out of scope — explicitly excluded per the delivery brief).
- No lint script enforcing this convention (deliberately declined at the epic level).

## Decisions

1. **`schemas/` domain subdirs (HEL-636, new scope not in the original ticket): one
   `schemas/README.md` explaining the grouping, not 14 per-domain READMEs.** The ticket's own
   guiding principle is "four lines beats forty" — with 14 domain dirs that are pure JSON Schema
   groupings (no code, no slice convention to explain per-dir), 14 near-identical four-line stubs
   would say nothing that one README enumerating "one subdirectory per domain capability" doesn't
   already say more usefully. Revisit only if a future domain dir develops genuinely distinct
   internal structure worth calling out.
2. **Frontend feature READMEs are per-feature, not folded into the existing
   `frontend/src/features/README.md` index — and that index README must be corrected, not left
   as-is.** It currently lists only 2 of 14 features (`dashboards`, `panels`) and describes the
   slice convention in aspirational language ("Each feature *should* own..."). That is exactly the
   stale-README failure mode this ticket exists to eliminate, and falls squarely under the
   ticket's own "fix or delete any README that no longer matches its directory" scope item. Rewrite
   it to list all 14 feature dirs (verified via `ls frontend/src/features`) and to state the
   convention as fact, not aspiration — while per-feature READMEs answer a narrower question
   ("what belongs in *this* feature's `services/state/types/ui`") that only makes sense once inside
   a given feature's directory. Both are kept, corrected relationship.
3. **`frontend/src/{shared,hooks,utils,services}` distinctions are resolved from actual import
   usage, not directory names**, per the delivery brief's explicit instruction — the executor
   will `grep`/read each directory's contents and a sample of its consumers before writing the
   "does not belong here" line, not infer it from the name alone. Verified pattern (Planning-time
   full enumeration, not a sample — `ls` run against all 14 feature dirs): top-level
   `hooks/utils/services` hold code shared *across* multiple features, and every one of the 14
   feature dirs already has at least one of its own feature-local `hooks/`/`utils`/`services`
   subdirs (e.g. `features/dashboards/{hooks,utils,services}`; not every feature has all three —
   `assistant`/`dataTypes`/`metrics`/`patchSets`/`proposals`/`settings` have only `services`,
   `layout`/`onboarding`/`toasts` have only `hooks`) — the top-level dir is for cross-feature reuse,
   the feature-local one is for logic that belongs to a single feature and should not leak out.
   `shared/` holds two subdirs, `chrome/` (app-shell/navigation components: `SidebarBody`,
   `BottomNav`, `MobileNavSheet`, `OverlayProvider`) and `ui/` (generic, feature-agnostic UI
   primitives: `Modal`, `Toast`, `IconButton`, `FormField`, `Skeleton`) — no
   `features/*/shared` exists, so `shared/`'s own README distinguishes `chrome/` (things that
   compose the app's persistent shell) from `ui/` (things any feature might render inside its own
   content), each cross-referencing the other rather than a nonexistent feature-local `shared/`.
4. **Explicitly out of scope within `frontend/src/`:** `app/` and `store/` already have accurate,
   current READMEs (verified: both correctly describe their directories' present contents — no
   action). `config/`, `context/`, `test/`, `theme/`, `types/` are single-purpose, low-ambiguity
   directories the ticket's own scope list never named (only `shared/hooks/utils/services` were
   called out as needing the shared-vs-feature-local distinction) — left untouched here, same as
   the epic's own "do not describe a directory the epic has not produced" boundary applied to
   scope not requested. Stated explicitly so the eventual completeness count in the PR is honest
   about what it does and doesn't cover, rather than silently omitting them.
5. **Backend gap dirs exclude pure namespace directories** (`scala/`, `com/`, `com/helio`) — these
   hold no code of their own, only child packages; a README there would say nothing a listing of
   its subpackages doesn't already convey, and the ticket's own inventory (6 gaps) already
   excludes them.
6. **No spec-level requirement changes** — this proposal introduces no new/modified capability, so
   no `specs/` delta file is created; the change archives with `--skip-specs`.

## Risks / Trade-offs

- [Risk] A README written from directory-name pattern-matching would pass every automated gate
  (no lint backs this convention) while being subtly wrong. → Mitigation: the executor must `ls`
  each directory and read file names before writing; the skeptic is specifically briefed to
  sample-check claims against `ls` output, per the delivery brief.
- [Risk] The `schemas/README.md`-not-fourteen-stubs decision is itself a judgment call that could
  be second-guessed. → Mitigation: reasoning stated explicitly above and in the PR description;
  easy to reverse later if wrong (add per-domain READMEs) since this is docs-only.

## Planner Notes

Self-approved: no external dependencies, no architectural change, no breaking change, no scope
beyond the ticket (the `schemas/` domain-subdir addition is a re-enumeration correction, already
implied by the ticket's own "epic's finished tree" framing and by the human's delivery brief,
which calls it out explicitly as a scope item to decide deliberately).
