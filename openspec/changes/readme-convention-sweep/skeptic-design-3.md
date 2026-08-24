## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**R2 item 1 — the 14/14 feature-local subdir claim (independently re-derived, full enumeration).**
Ran `for d in frontend/src/features/*/; do ls -d $d*/; done` over all 14 feature dirs:

| feature | hooks | utils | services |
|---|---|---|---|
| assistant | | | x |
| auth | | x | x |
| dashboards | x | x | x |
| dataTypes | | | x |
| layout | x | | |
| metrics | | | x |
| onboarding | x | | |
| panels | x | | x |
| patchSets | | | x |
| pipelines | x | | x |
| proposals | | | x |
| settings | | | x |
| sources | x | x | x |
| toasts | x | | |

All 14 have at least one — design.md D3 and tasks.md 3.1 are now accurate. The parenthetical
breakdown is also correct as written: `assistant/dataTypes/metrics/patchSets/proposals/settings`
have only `services` (confirmed), `layout/onboarding/toasts` have only `hooks` (confirmed),
`dashboards` has all three (confirmed).

**R2 item 2 — schemas/README.md conflict.** tasks.md 4.1 now reads "`schemas/` is handled
separately by 4.2 below, not here — do not also write a generic one-liner `schemas/README.md`
in this task", and 4.2 states "This is the only README written for `schemas/` —
supersedes/replaces task 4.1's scope for this one directory". Single writer, no conflict. Resolved.

**Other design claims spot-checked against the live tree:**
- 6 backend gap dirs all exist and all lack a README (`email`, `spark`, `ai`, `domain/{panels,shapes,steps}`) — confirmed MISSING for each.
- `schemas/` has exactly 14 domain subdirs (agent-memory…workspace) — confirmed, matches D1.
- Top-level: `infra/README.md` exists; `scripts/`, `e2e/`, `docs/`, `schemas/` all MISSING — matches task 4.1/4.2 scope exactly.
- `frontend/src/*/README.md` exists only for `app`, `features`, `store` — so `shared/hooks/utils/services` genuinely lack READMEs (tasks 3.1/3.2) and D4's "app/ and store/ already have READMEs" holds.
- `frontend/src/features/README.md` verbatim: lists only `dashboards` and `panels`, and says "Each feature **should** own UI, state adapters, selectors, and tests." — exactly as D2/task 2.2 describe. Stale-README claim confirmed.
- `frontend/src/shared` has exactly two subdirs `chrome/` and `ui/`; every named example exists (`SidebarBody`, `BottomNav`, `MobileNavSheet`, `OverlayProvider` in chrome; `Modal`, `Toast`, `IconButton`, `FormField`, `Skeleton` in ui). No `features/*/shared` exists — confirmed by the enumeration above.
- `grep -rl` for `com/helio/security` / `com.helio.security` / `testutil` across all `README.md` returns nothing — tasks 1.2 and 5.1 will confirm a true negative, not chase a phantom.

**Coverage/consistency:** every ticket scope item maps to a task; task 5.3's enumeration
(6 + 14 + 1 + 4 + 4 + 1) matches what I counted on disk. No placeholders, TODOs, or deferred
decisions remain. No new contradictions between proposal → design → tasks.

### Verdict: CONFIRM

### Non-blocking notes
- design.md D3's parenthetical breakdown is accurate but not exhaustive: it does not name the
  subsets for `auth` (services+utils), `panels`/`pipelines` (hooks+services), or `sources`
  (all three). Nothing in it is false and the load-bearing 14/14 claim is correct, so this is
  not blocking — the executor is instructed to `ls` each dir anyway (task 2.1/3.1).
- `frontend/src/shared/chrome` and `ui` both contain files beyond the cited examples
  (`chrome/usePickerSelection.ts`, `ui/useScrollEdges.ts` are hooks living inside component
  dirs). Worth a sentence in `shared/README.md` so the chrome-vs-ui line doesn't read as
  "components only".
