## Skeptic Report — final gate (round 5, skeptic-final-5.md)

Reviewed HEAD fcfbd43d7cd2651dd49990fca92d81efbb0e9918 (PR #1068). The diff base was resolved live with
`resolve-review-base.sh`: 069afd36d (origin/main). Full diff `069afd36d...HEAD` read (32 files). The worktree is clean
apart from the untracked evaluation-5.md.

### What I verified (with evidence)

- **Spawn guard.** `READY ambient=/home/matt/Development/helio branch=bug/home-phone-timeline-shift/HEL-1665`.
- **Unit and static gates (re-run by me).**
  - Home and appearance-token jest: 16 suites, 118 tests pass.
  - `tsc --noEmit`: exit 0.
  - eslint `src/features/home src/theme --max-warnings 0`: exit 0.
- **e2e (re-run by me).** Run under the e2e lock with `nice -n 19`, 2 workers, `--trace retain-on-failure`, against the
  canonical servers on 7097/10004. Specs: hel1665, hel1642, hel1572, hel1583-home-375, hel1578-home-page and
  hel1578-home-changed-dot. Result: **89 passed, EXIT=0**, and 89 throwaway users were deleted by recorded id.
  Log: `/home/matt/Development/helio/.concertino/runs/HEL-1665/evidence/.concertino/sk5-e2e.log`.
  - **AC1, Sans.** I parsed all 32 `HEL1665-SHIFT` cases: 375×667, 375×812, 430×932, 480, 540, 620, 1024 and 1280, in
    light and dark, in both release orders. The runs-top, content-top and shelf-top spreads are all 0, and the
    settled line counts are 2 at ≤540 and 1 at ≥620.
  - **AC1, other type styles.** `HEL1665-STYLE`:
    - Mono 1280: 0/0/0, 2 lines.
    - Mono 375×667: 0/0/0, 3 lines.
    - Serif 1280: 0/0/0, 1 line.
    - Serif 375×667: 0/0/0, 2 lines.
  - **Cold-load swap.** `fontSwapSpread` was 3–4px. It is recorded and not asserted, per the owner ruling.
  - **C1.** "Home settled at 1280x900 (light|dark): boxes equal the pinned base numbers" passed. The pins are the
    base-measured numbers at spec :217-281.
  - **AC2 guard** passed at 375×667 in light and dark.
  - **hel1572** passed in full. **hel1642** passed.
- **Does nowrap keep ghost/real parity at every width above 768px? Yes, with the web fonts loaded.**
  - This is the one place parity is not true by construction. I checked it live by injecting a real-sentence copy and
    a ghost copy into `.home-opening` and switching `data-type-style` in the DOM only (no server write).
  - At 1280 the ghost/real heights are Sans 30/30, Serif 30/30 and Mono 60/60. Mono's computed `white-space` is
    `normal`.
  - At 769px, the narrowest width above 768, `.home-opening` is 665px wide. That is wider than the natural one-line
    width of the default sentence in Sans (581.3px) and Serif (573.5px). Ghost/real heights there are Sans 30/30,
    Serif 30/30 and Mono 60/60.
  - At 1101 the box is 997px. It widens monotonically, so nowrap cannot desync at any width above 768.
- **Visual check (settled).** DOM-only theme and style switch on the dev account. I looked at each screenshot:
  - 1280 light Mono: `.../sk5-home-1280-light-mono.png`. The sentence is two lines and the "All 6 →" link is aligned.
  - 1280 dark Serif: `.../sk5-home-1280-dark-serif.png`.
  - 620 light Mono: `.../sk5-home-620-light-mono.png`. The link's `::after` is 44×44, the head is 19px, there is no
    horizontal overflow, and the expander does not grow the head.
  - 375×667 dark Serif: `.../sk5-home-375x667-dark-serif.png`. There is no horizontal scroll (scrollWidth 375).

  All are under `/home/matt/Development/helio/.concertino/runs/HEL-1665/evidence/.concertino/`. Spacing, the type
  hierarchy and light/dark parity are consistent with sibling screens. This round changes only a hidden element's
  wrap, so there is no settled visual change.
- **The theme.css token and the appearanceTokens test change. Here the change diverges from a merged spec.**
  - `openspec/specs/appearance-preferences/spec.md:31-33`, "Requirement: Type style is applied through font tokens",
    says: "The type style SHALL be applied by a root attribute that **switches font tokens only**, with no component
    branching on the style."
  - fcfbd43d7 makes `:root[data-type-style="mono"]` also switch `--heading-sentence-wrap: normal` (theme.css:203).
    That is a `white-space` value, a text-layout token, not a font token.
  - `appearanceTokens.css.test.ts` is the guard for exactly that requirement. Its describe is "type-style tokens
    (font tokens only)" and its Mono test was "...and nothing else". The change loosened the Mono test to admit the
    non-font declaration and left the describe title asserting "font tokens only".
  - There is no spec delta to `appearance-preferences` in this change (`git diff --stat 069afd36d...HEAD --
    openspec/specs` shows only `home-page/spec.md`).
  - So the guard was weakened to let the code pass a requirement the merged spec still states. That is not honest as
    it stands, even though the new list is still an exact-match `toEqual`.
  - evaluation-5 judged only the file's conventions and DESIGN.md's "token override, never a component branch". It
    did not check the spec's "font tokens only".
  - The DESIGN.md "Type styles (HEL-1572)" bullet (DESIGN.md:385-392) gives Mono's override as
    `--font-sans: var(--font-mono)` only. It now misstates what theme.css does.
  - The token's name is generic ("heading sentence wrap"), but its meaning is Home-specific: "Home's hidden placeholder
    is one line above 768px". That is a component knob in the global token layer.
  - Round 4's REFUTE and evaluation-4's CR1 each closed one binding rule: no component branch, and no Mono shift.
    This head satisfies both of those and breaks a third rule, the merged appearance-preferences requirement.
- **Gate-defect check (CON-160).** No report I drilled into relies on mtime ordering. No defect to record.
- **Servers.** Started with `start-servers.sh` (`PASS servers`) and stopped with `stop-servers.sh`. I created no data.
  I used the shared dev account read-only, with DOM-only attribute switches.

### Verdict: REFUTE

### Change Requests

1. **frontend/src/theme/theme.css:32-35 and :203, plus frontend/src/theme/appearanceTokens.css.test.ts:61-87.** The
   Mono type style now switches a non-font token. That contradicts
   `openspec/specs/appearance-preferences/spec.md:32` ("switches font tokens only"), and the guard test was loosened
   to allow it. Resolve it one of two ways:
   - **(a) Drop the per-style wrap.** Remove `--heading-sentence-wrap` and the ghost's nowrap, so the ghost wraps
     freely. Parity then holds by construction in every style, as it did at round 3. The cold-load swap grows under a
     wide fallback, as cycle 6 measured, but the owner ruled it "recorded, not asserted". Re-measure and correct the
     DejaVu numbers in both spec copies, design.md and item2-owner-handoff.md. Restore the appearanceTokens test to its
     base form.
   - **(b) Keep the token and make the contract say so.** Add a MODIFIED `appearance-preferences` spec delta that
     allows this one typographic layout token. Update the DESIGN.md Type styles bullet (DESIGN.md:385-392) to list the
     Mono override. Retitle the test describe so it no longer claims "font tokens only". Consider a name that says what
     the token is for (it is Home's placeholder wrap).

   The Mono and Serif held-load e2e must stay green and must stay asserted under whichever option you choose.

### Non-blocking notes

- Settled UI, the 0px series, C1 and hel1572 are all sound on this head. This REFUTE is a contract and standard
  consistency issue, not a visual or behavioural one.
- **Edge case if (b) is kept.** A user with a larger browser default font size (for example 20px, so `--text-2xl` =
  30px) at 769-~870px has a real Sans sentence (~726px natural) wider than the 665px box. The real sentence then wraps
  to two lines while the nowrap ghost stays one line, which is a data-load shift. Option (a) removes this. I did not
  measure it; it is inferred from rem scaling of the 581px measurement above.
- `DashboardShelf.tsx`: the nested `aria-hidden` inside the already-hidden slot is redundant (carried over).
