## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold spawn. Every conclusion below is derived from the worktree at HEAD `c1caae9b`,
not from evaluation-2.md or skeptic-final-1.md.

### What I verified (with evidence)

**1. The round-1 rename fix is correct and pure (verified).**
`git show c1caae9b -- frontend/src` is exactly 8 changed code lines across the 3 cited
files, all pure identifier renames (import specifier + JSX/`variantIcon` map reference).
No leftover import artifacts, no stray references, nothing touched beyond the 3 named
files. `grep -rnE '\b(AlertTriangle|CheckCircle2|XCircle)\b' frontend/src` → zero hits.
`TriangleAlert`/`CircleCheck`/`CircleX` resolve correctly at all renamed sites, and both
`ICON_SIZE.sm` props and `aria-hidden` attributes survived the rename intact.

**2. The CSS-class-string concern is genuinely a non-issue (independently confirmed,
not inherited from the executor's grep).** I rendered alias and canonical components
side by side via `renderToStaticMarkup`:

```
AlertTriangle: "lucide lucide-triangle-alert" | TriangleAlert: "lucide lucide-triangle-alert" same=true
Filter:        "lucide lucide-funnel"         | Funnel:        "lucide lucide-funnel"         same=true
History:       "lucide lucide-rotate-ccw-clock"| RotateCcwClock:"lucide lucide-rotate-ccw-clock" same=true
```

The emitted class derives from the *canonical* component identity, not the import name,
so an import rename cannot change rendered markup. Independently, `grep -rnE "\.lucide-[a-z-]+"
frontend/src --include=*.css` returns zero — no stylesheet keys off these classes. Confirmed
non-issue on both legs.

**3. All gates re-run fresh by me at current HEAD — all green.**
- `npx tsc --noEmit` → exit 0
- `npm run lint` (`eslint src --max-warnings=0`) → clean
- `npm run format:check` → "All matched files use Prettier code style!"
- `npm test` → **301/301 suites, 3197/3197 tests, 1 snapshot** passed
- `npm run build` → succeeds; `grep -rli fontawesome dist | wc -l` → **0**

**4. ACs re-checked at HEAD.** AC1: `grep -rn "@fortawesome" frontend/src` → 0;
`grep -c "@fortawesome" package.json package-lock.json` → **0 and 0**. AC2/AC3 carried
from round 1's exhaustive sizing/a11y pass, re-confirmed unperturbed by this commit
(the rename touched no sizing or aria attribute). AC4 per gate run above. **All four ACs met.**

**5. Regression sanity pass on the rename commit specifically — clean.** Diff is
pure-rename as claimed; no new unsized icon, no file touched beyond the 3 named
(the 4th path in the stat is `skeptic-final-1.md`, the report artifact).

### The finding: the round-1 defect class is only partially remediated

I ran a systematic scan instead of spot-checking — parsing lucide-react's own export
table into a canonical/alias map, then checking every lucide identifier imported anywhere
in `frontend/src` against it. Result: **78 distinct identifiers used, 70 canonical, 8 still
legacy aliases.**

```
LEGACY ALIAS: AlertCircle -> CircleAlert          ToolCallIndicator.tsx
LEGACY ALIAS: AlignLeft   -> TextAlignStart       stepNarrowing.ts   (also OutputPicker.tsx, pre-existing)
LEGACY ALIAS: BarChart3   -> ChartColumn          stepNarrowing.ts
LEGACY ALIAS: CheckSquare -> SquareCheckBig       stepNarrowing.ts
LEGACY ALIAS: Filter      -> Funnel               stepNarrowing.ts
LEGACY ALIAS: HelpCircle  -> CircleQuestionMark   UserMenu.tsx
LEGACY ALIAS: History     -> RotateCcwClock       AuditHistorySection.tsx, RunHistoryModal.tsx
LEGACY ALIAS: LineChart   -> ChartLine            OutputsRail.tsx, OutputGalleryCard.tsx, OutputsGalleryTab.tsx
```

These are the **same construct** round 1 refuted, from the same export line in the
installed package (`lucide-react@1.40.0`): `CircleAlert as AlertCircle` sits in
`lucide-react.d.ts:27050` immediately beside `TriangleAlert as AlertTriangle`, the one
already fixed. Runtime identity reproduced for all 8 (`AlertCircle === CircleAlert : true`,
etc., all `true`, canonical present in every case) — reproduced twice, stable.

**11 of these 12 usages are newly introduced by this branch**, not inherited. I verified
per-file against `main`: every one of these 9 files was previously FontAwesome with no
lucide import at all (`lucide-import-lines-on-main=0`). The added lines are in the diff,
e.g. `+import { HelpCircle, LogOut, Settings, User as UserIcon } from "lucide-react";` and
`+  { id: "filter", label: "Filter rows", icon: Filter },`. The single exception is
`AlignLeft` in `OutputPicker.tsx`, which pre-existed on main and is out of scope.

**Why this blocks, stated honestly.** Runtime impact is zero — same component, same
markup, same pixels, same bundle. This is a source-vocabulary matter. But it blocks for
two reasons:

- **Adjudication consistency.** Round 1 refuted 3 usages of this exact construct on the
  ground that they are "lucide-react's deprecated legacy aliases ... instead of their
  canonical names." That reasoning applies verbatim, and to a strictly larger instance.
  Confirming now would make round 1's REFUTE arbitrary.
- **The fix addressed the citation, not the class.** The executor renamed exactly the 3
  files named and stopped. The branch's own convention is canonical naming (70 of 78);
  these 8 are the deviation, being introduced by the very commit that establishes the
  app's single icon vocabulary. The concrete forward hazard is mechanical: `lucide.dev`
  search returns `Funnel`, so the next developer importing `Funnel` creates precisely the
  one-glyph-two-names split that round 1 classified as a defect.

I want to be explicit that I am not manufacturing a new objection — this is the same
objection, incompletely remediated, found by generalizing round 1's check rather than
re-running it narrowly.

### Verdict: REFUTE

Escalation note for the human driver: this is the last round in the budget, and the
decision here is cheap either way. Two acceptable resolutions —
**(a)** apply the 11 renames below (pure identifier renames, provably zero rendered
change per evidence item 2, ~15 minutes, no test updates needed); or
**(b)** rule alias naming non-blocking and ship as-is — in which case the 3 renames in
`c1caae9b` should arguably be reverted so the codebase is at least uniform in its
convention. What should not ship is the current in-between state, where 3 sites were
canonicalized and 11 equivalent ones were not.
Everything else about this change is sound and I would confirm it without hesitation.

### Change Requests

1. `frontend/src/features/assistant/ui/ToolCallIndicator.tsx:5,74` — rename `AlertCircle`
   → `CircleAlert` (import specifier and the `RowIcon` ternary).
2. `frontend/src/features/pipelines/state/stepNarrowing.ts` — rename in the lucide import
   block and each `icon:` entry: `AlignLeft` → `TextAlignStart`, `BarChart3` →
   `ChartColumn`, `CheckSquare` → `SquareCheckBig`, `Filter` → `Funnel`.
3. `frontend/src/features/auth/ui/UserMenu.tsx` — rename `HelpCircle` →
   `CircleQuestionMark` (import + JSX site).
4. `frontend/src/features/audit/ui/AuditHistorySection.tsx` and
   `frontend/src/features/pipelines/ui/RunHistoryModal.tsx` — rename `History` →
   `RotateCcwClock` (import + JSX sites).
5. `frontend/src/features/pipelines/ui/OutputsRail.tsx`,
   `frontend/src/features/pipelines/ui/OutputGalleryCard.tsx`,
   `frontend/src/features/pipelines/ui/OutputsGalleryTab.tsx` — rename `LineChart` →
   `ChartLine` (import + JSX sites).
6. Re-run the alias scan to zero before returning, rather than checking only the sites
   cited above — the class, not the citation. Equivalent one-liner: parse the
   `export { ... }` line of `node_modules/lucide-react/dist/lucide-react.d.ts` for
   `X as Y` pairs (ignoring the `*Icon` suffix forms) and assert no imported identifier
   in `frontend/src` appears as a `Y`.

Note: `AlignLeft` in `frontend/src/features/panels/ui/OutputPicker.tsx:3` pre-exists on
`main` and is **out of scope** — do not fix it here; if desired it belongs in a follow-up.

### Non-blocking notes

- The 3 renames in `c1caae9b` are correct and should be kept under resolution (a).
- Consider a lint rule (e.g. `no-restricted-imports` with the alias names) so deprecated
  aliases cannot re-enter after this ticket normalizes the vocabulary. Natural spinoff,
  not required here.
