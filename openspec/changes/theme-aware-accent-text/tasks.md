# Tasks

**References are to `design.md`'s frozen D-numbers.** A D-number is an identifier, not a position — see
`design.md` rule 3. This file **references sections rather than restating figures**: where a number is needed,
the owning decision is named. That is deliberate — every stale number in this plan's history survived by being
restated somewhere a later correction did not reach.

## 1. Inventory (AC-4)

- [x] 1.1 **Build the inventory from the transitive closure named in D9**, not from a pattern over token names.
      Run `/home/matt/Development/helio/.concertino/runs/HEL-1048/evidence/skeptic3-accent-text-closure.py`.
      It resolves every declaration reaching `--app-accent` by any number of hops and independently
      rediscovers every class in `design.md` without being told about any of them.
      **Do not hand-write a pattern.** Three of the five reachability classes were invisible to *any* pattern
      over token names, and the one narrowing that looked most justified is what hid D8's class.
- [x] 1.2 Classify every declaration the closure returns into the five background classes the site-inventory
      section of `design.md` enumerates. For the token-tinted class, **re-derive the rule set mechanically** —
      hand counts of that class returned four different answers during design and none was right.
- [x] 1.3 Establish **rendered** instances, not closure hits. Two major routes render zero accent text; the
      densest real surface and the hover/focus-only rules are named in the site inventory.
- [x] 1.4 Name every user-chosen-surface site explicitly as out of scope, owned by **HEL-1057** — not
      HEL-1051, which is focus indicators at 3:1 (the same component, a different obligation).

## 2. Derivation

- [x] 2.0a **Re-derive the final adjustments for BOTH themes** from the complete scored set (D2). D3's
      tables are explicitly non-final — D2 item 3 raises both rows, not only the dark one — so neither
      theme's figures may be taken from `design.md`. This task owns the numbers; everything downstream
      consumes them.
- [x] 2.0 **D4 gate — before any site is repointed.** Take the dark values from 2.0a, render them on the
      running app and judge perceptibility side by side against the raw accent. **Include Orange**, the shipped default, which the rendered contact sheets never varied.
      **Trigger:** if any is distinguishable at 14px on `--app-surface`, escalate before implementing — the
      brand ruling would then rest on evidence that no longer matches the proposal. Do not escalate on the
      numbers alone; the question is perceptual.
- [x] 2.1 Add the per-theme, per-accent text derivation (D1) in `frontend/src/theme/appearance.ts`. It takes
      the accent **and** the theme. Record in the code why this token is theme-aware while
      `--app-focus-ring-color` is not — the empty luminance window in `design.md`'s Context section — or
      someone will unify them.
- [x] 2.2 Score against **exactly** the set D2 defines — its three included items, and neither of the two it
      explicitly excludes. Re-parse the surface hexes and token tint percentages from `theme.css` at
      build/test time; **parse the inline tints from their own component stylesheets**, since they are not in
      `theme.css`. Do not hardcode copies of either.
- [x] 2.3 Do not add a second token or replace any tint with a neutral. D3 established one token per theme
      suffices for all eight presets; if your implementation disagrees, that is a finding — stop and report.
- [x] 2.4 Emit the token from `buildAccentTokens`, leaving `--app-focus-ring-color` theme-independent and
      unchanged (AC-3).

## 3. Lifecycle (D10)

- [x] 3.1 Make the accent effect re-apply on **theme** change as well as accent change. Verify by switching
      theme without touching accent and confirming the token updates.
- [x] 3.2 Add the static `:root` fallback per **D14** and confirm no wrong-colour flash on first paint.
      D14 also states why this does not contradict D12's removal of the dead per-theme declarations —
      read both before editing `theme.css`.

## 4. Repoint

- [x] 4.1 Repoint rendered accent-**text** sites at the new token. Leave fills, borders and decoration on
      `--app-accent` — the owner ruled `text-only-token`.
- [x] 4.2 Repoint the `--app-accent-strong`-as-text sites per D8, **including its named exception**: the
      link/hover pair that would collapse to a no-op needs a distinct hover treatment. Check every other
      repointed site for the same base/hover collapse.
- [x] 4.3 Fix the alias-chain sites per D9, following chains **transitively**. One hop is not enough.
- [x] 4.4 `::selection` per D7: set **both** properties, with the opaque per-theme background resolved in
      TypeScript and `--app-text` as its colour. Do **not** set colour alone, do **not** use the page
      background/text pair, and do **not** add the selection hex to D2's scored set — D7 gives the reason for
      each, and task 5.5 carries the check that replaces scoring it.
- [x] 4.5 Correct or remove the dead per-theme defaults and make the false comment true (D12).
- [x] 4.6 Do not touch `--app-focus-ring` or `--app-focus-ring-color` consumers (HEL-1046/HEL-1050).

## 5. Guard (D5, D11)

- [x] 5.1 Assert the derivation clears the text floor for 8 presets × 2 themes × every background in D2's set.
      Re-parse surfaces and tint percentages rather than hardcoding.
- [x] 5.2 **Build the guard corpus from D9's closure**, not from a hand-list of aliases. A one-hop list passes
      the two-hop chain green — which is the defect the closure exists to prevent.
- [x] 5.3 **Assert producibility** (D5): for every proposed value, some integer percent of the derivation
      yields exactly that hex. A ratio-only check accepts colours the derivation cannot emit.
- [x] 5.4 Assert `--app-focus-ring-color` is still theme-independent and HEL-1046's guard still passes (AC-3).
- [x] 5.5 Assert the `::selection` **fixed pair** — its colour against the opaque selection background, per
      theme (D7).
- [x] 5.6 Write the predicate against the **whole stylesheet corpus** (D11) and **mutation-test it against a
      rule this change does not edit**. Verify each mutation lands and fails **for the stated reason**; a
      probe whose pattern silently fails to match returns a meaningless green.

## 6. Verify on the running app

- [x] 6.1 Start servers (`scripts/concertino/start-servers.sh`, ports 6480/9387).
- [x] 6.2 **Self-authenticate the server**: `curl` the dev port for a branch-only string. Do not use a
      TypeScript type — Vite strips types. Several worktrees are live, so a port check is insufficient; a
      `/@fs` root-restriction check (this worktree 200, sibling checkout 403) is the strongest available proof.
- [x] 6.3 Drive the **real `AccentPicker`** — accent is server-preference-backed, so `localStorage` exercises
      the wrong path. **Known hazard:** the first accent change of a session can update the DOM with zero
      persistence requests logged. Check the network, not just the DOM.
- [x] 6.4 **Settle before reading.** These elements carry a colour transition; a short settle reads
      mid-transition values, and a sub-second settle can read the dead light-theme accent that
      `design.md`'s Context section warns about.
- [x] 6.5 Record **painted colour** and **measured background** per site and compute the ratio from those two
      measured values. Cover every background class in D2's set. Say **which preset, which surface, which
      theme** on every row.
- [x] 6.6 The login-footer "Create one" link specifically passes (AC-2).
- [x] 6.7 Assert every measured ratio meets the floor. The only permitted exception is a site whose binding
      surface is user-chosen (HEL-1057, out of scope) — record it as a number, do not wave it through.

## 7. Required evidence

- [x] 7.1 **Capture the login-card pairing for the worst preset:** darkened accent text beside the still-bright
      accent button fill, both themes. The owner accepted this consequence knowingly, but it is ours to show.
      **If it reads as broken rather than merely different, say so plainly and escalate — do not ship it
      quietly.**
- [x] 7.2 Record task 2.0's perceptibility comparison in the evidence directory either way.

## 8. Documentation

- [x] 8.1 `DESIGN.md` — record the token and the derivation: the empty luminance window, that it rules out
      **every** colour rather than only the shipped presets, and why this token is theme-aware while the
      focus-ring token is not.
- [x] 8.2 Record the scoring rule — that the obligation is scored against every background the text can land
      on, including accent-derived ones — and why omitting a class cancels the fix.

## 9. Gates and handoff

- [x] 9.1 From `frontend/`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`,
      `npm run check:tokens`. **Root `npm test` is `jest --passWithNoTests && npm --prefix frontend test`** —
      in a worktree root it finds zero tests and turns silence into a pass. Run the frontend suite explicitly.
- [x] 9.2 `files-modified.md`: **one bullet per file, full path from the repo root.** Continuation lines and
      abbreviated names have been rejected by the squash guard twice on this batch.
- [x] 9.3 Commit before yielding. An uncommitted handoff is an incomplete one.
- [x] 9.4 Name every site left unfixed with its reason and owning ticket (AC-4).
- [x] 9.5 Write evidence to the **main checkout** evidence directory, never the worktree — the worktree copy is
      deleted at cleanup, and stray `.js` files there break ESLint.
