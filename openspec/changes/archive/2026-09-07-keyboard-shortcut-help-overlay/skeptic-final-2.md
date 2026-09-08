## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Fresh cold spawn. Scope per the orchestrator: round-1's blocking CR1, anything the fix could have
broken, and any new blocking defect. Everything below is measured; nothing is taken from
files-modified.md or evaluation-2.md.

### What I verified (with evidence)

**1. The round-1 CR1 fix is real, in the running app — not just in the diff.**
Pressed `?` in the live app at `localhost:5942` (authenticated session) and measured the actual
element, both themes:
```
.help-overlay__rows computed: padding "0px" | margin "0px" | list-style-type "none"
groupLabel.x = 531   row.x = 531   (was 531 / 571 in round 1)
groupLabel.right = 909   row.right = 909
gap under eyebrow = 8px  (= --space-2, was 8 + 16)
gap between groups = 16px (= --space-4, was 16 + 16 + 16)
```
The 40px indent is gone and both declared spacing tokens now mean what the file says they mean.
Screenshots taken and looked at (element-scoped, light and dark): rows are flush with their own
GENERAL / LAYOUT eyebrow, keycaps right-aligned in a clean column, the two-line "Redo…" row wraps
without disturbing its cap group. Dark parity holds — identical geometry, caps still legible.
Consistent with the sibling `command-palette` surface it mirrors. **0 console errors.**

**2. I re-ran the mutation myself. The new e2e guard is genuinely failable.**
Removed the three added lines from `HelpOverlay.css:18-20`, then ran the new test alone:
```
✘ ? overlay's row list has no inherited UA list spacing …
  Expected: "0px"   Received: "40px"      (spec line 70)
```
Restored the file; `git status` clean; full spec re-run **7/7 passed (20.3s)** against the running
dev server. So the fix is demonstrated-red-then-green by my own hand, not asserted. The guard is
labelled as a CR-derived guard in its header comment.

**3. But the guard's geometry half IS incidentally satisfied — I probed it.** See note 1 below.
This does not undermine (2): the computed-style assertions are what discriminate, and they do.

**4. The refusal to extend `KeyCap.css.test.ts` to scan `HelpOverlay.css` is correct engineering,
not evasion.** I agree, and for a reason I confirmed rather than accepted: nothing was *written* —
`padding-inline-start: 40px` never appears in any source file; it is a user-agent default resolved
at render time. A regex over CSS source text is structurally incapable of going red on this defect,
and jsdom cannot resolve UA defaults either. A scan added here would have passed both before and
after the fix — the textbook evidence-shaped non-evidence this project has already been burned by.
The real-browser computed-style assertion is the only honest guard, and it is the one that shipped.

**5. `design.md` now matches the shipped code.** Read Decision 1 against `useShortcut.ts`: the doc
now says the map "is a module-level singleton in `shared/chrome/useShortcut.ts`, not a
React-context-held provider", with the lazy attach/detach and the no-provider-needed test rationale.
That is exactly `useShortcut.ts:37` (`const registry = new Map…`), `ensureListenerAttached`,
`detachListenerIfIdle`. The frozen `ShortcutOptions` block in the doc is character-for-character the
shipped interface. The published reference HEL-516/519/503 will read is now accurate.

**6. Nothing the fix could plausibly have broken is broken.** The commit touches only
`HelpOverlay.css` (3 lines), the e2e spec (additive), and docs. From `frontend/` (not the worktree
root — the `--passWithNoTests` trap): `npm run lint` clean, `npm run typecheck` clean. Full e2e spec
green as above. The 2801-test jest suite cannot be affected by a CSS-only change and was already
verified in round 1 against the same component tree.

**7. The two left-unchanged non-blocking items are acceptable dispositions.** The duplicate-id
silent-replace is a genuine sharp edge for the panel-scoped bindings HEL-516/519/503 will add, and
the write-only `ShortcutDeclaration.label` is dead weight — but both are additive, neither changes
any shipped behavior, and neither is something a downstream ticket is blocked by (they will hit the
duplicate case only if they deliberately reuse an id, which the declaration file makes visible).
Recording them in files-modified.md rather than fixing them in a final-gate round is the right call.

### Verdict: CONFIRM

Ships. The one blocking defect from round 1 is fixed, verified in the running app in both themes,
and guarded by a test I personally drove red. The finding below is real but is **polish, not
blocking** — it does not affect shipped behavior and does not weaken the guard that actually guards.

### Non-blocking notes

1. **`e2e/hel510-keyboard-shortcuts.spec.ts:77-83` — the geometry assertion is decorative, and its
   comment claims otherwise.** It compares `rowsList.boundingBox().x` (the `<ul>`) against the group
   label's `x`. A `<ul>`'s border box does not move when its *padding* grows — the padding is inside
   it. I measured this directly under the mutation:
   ```
   COMPUTED {"paddingLeft":"40px", …, "listStyleType":"disc"}
   GEOM  ul.x=451.78  label.x=451.78  row.x=491.44     → the ul assertion PASSES while broken
   ```
   With only the computed-style expects stubbed out, the geometry half stayed **green on the broken
   CSS**. So the comment "Discriminating geometry assertion (the exact symptom the skeptic
   measured)" is false — the symptom I measured in round 1 was the *row's* x, not the list's.
   One-line fix: measure `.help-overlay__row` instead —
   `const rowBox = await page.locator(".help-overlay__row").first().boundingBox();` and compare
   `rowBox!.x` to `labelBox!.x` (491 vs 451 under the mutation → red; 531 vs 531 today → green).
   Not blocking because the four `getComputedStyle` expects immediately above it are demonstrably
   discriminating, so the test as a whole is failable by mutation. But a mislabelled assertion is a
   trap for the next person, who may "simplify" the computed-style expects and be left with a guard
   that guards nothing.
2. `design.md` Decision 1 still ends with "*Alternative rejected:* a mutable `registerShortcut()`
   module singleton" directly beneath the corrected text describing the module-level singleton that
   shipped. The distinction is real (hook-scoped registration with lifecycle cleanup vs. a bare
   imperative `registerShortcut()`), but as written the two paragraphs read as contradicting each
   other. Worth one clarifying clause before archive, since three tickets read this doc.
3. Round-1 note about full-sentence row descriptions with trailing periods still stands; still
   purely stylistic. Looking at the rendered overlay, it reads fine.
