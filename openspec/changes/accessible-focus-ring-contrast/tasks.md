## 1. Derive the ring colour

- [x] 1.1 In `frontend/src/theme/appearance.ts`, extend `buildAccentTokens(hex)` to emit a third token,
      `--app-focus-ring-color`, computed as the **MINIMUM** adjustment to `hex` that clears **3:1** against
      **EVERY declared surface in BOTH theme blocks** — take the minimum over all of them, do NOT derive
      against a chosen "worst" pair (design.md D1/D2).
      **The binding surfaces are NOT the palette extremes.** For a mid-luminance ring the extremes are the
      EASIEST; the binding ones are `--app-surface-soft` `#efece6` (light) and `--app-surface-strong`
      `#262320` (dark). Deriving against `#ffffff`/`#121110` yields Orange 4% / Cyan 11% / Green 14% /
      Yellow 21% / Pink 0%, all scoring **2.58–2.99 against `--app-surface-soft`** — i.e. this ticket's exact
      defect, shipped while passing its own proof.
      **Compute the darkening in TypeScript; do NOT implement it as CSS `color-mix`.** The margin ruling
      (bare minimum, no padding) depends on the value being an exact 8-bit hex applied inline — there is then
      no rounding path from 3.01 down to 2.99. A `color-mix` implementation breaks that argument and the
      thin margins stop being safe. **Keep the signature unchanged** — the value is
      theme-independent by construction (D3), so no theme argument and no `ThemeProvider` change.
      Measured need per preset: Red/Purple/Blue 0% (must render UNCHANGED), Pink 1%, Orange 12%, Cyan 18%,
      Green 21%, Yellow 28%. Verify: a unit test asserting each preset's derived value clears 3:1 and that
      the three already-passing presets are returned untouched.
- [x] 1.2 The derivation must be **total**: `setAccentColor` accepts any string and values round-trip
      through localStorage and the server, so an unparseable or pathological hex must yield a safe fallback
      rather than throwing or emitting nothing. Note `buildAccentTokens` already returns `{}` for an
      unparseable hex — decide and state what the ring does in that case. Verify by test.

## 2. Wire the token

- [x] 2.1 In `frontend/src/theme/theme.css`, add `--app-focus-ring-color` and change `--app-focus-ring`
      (line ~300) to `2px solid var(--app-focus-ring-color)`. **Width, style and `outline-offset` are
      UNCHANGED** — this is a colour fix, not a geometry change; `outline-offset` remains per-component and
      is not part of the token (HEL-1022's contract). Verify: existing focus-ring tests pass unmodified.
- [x] 2.2 `--app-accent` is NOT modified. Verify: a test asserting `--app-accent` computes to the raw preset
      hex, so brand rendering elsewhere is untouched.

## 3. Correct the dead declarations (same defect's cause, not scope creep)

- [x] 3.1 Correct or remove `theme.css`'s per-theme `--app-accent`/`--app-accent-ink` defaults (dark line
      ~163, light line ~209). Neither renders — `applyAccentTokens` writes inline style on `<html>`, which
      outranks both `:root[data-theme=…]` blocks. The light `#ea580c` reads as intentional per-theme tuning
      and is not one; that is what kept this defect invisible.
- [x] 3.2 Make the `theme.css:161-162` comment true about what actually happens at runtime.

## 4. The guard — a comment cannot fail

- [x] 4.1 Add a guard computing the derived ring colour's contrast against **every surface × both themes ×
      all 8 presets**, failing below 3:1. Verify by RUNNING the mutation: revert `--app-focus-ring` to
      `var(--app-accent)` and confirm RED. **Confirm the mutation actually landed** — a probe whose pattern
      silently fails to match returns a meaningless green.
- [x] 4.2 **The guard must RE-READ every surface from `theme.css` and RE-DERIVE which ones bind** — compare
      the ring against EVERY declared surface in both theme blocks and take the minimum, so the binding
      surface is an OUTPUT, not an assumption. Do NOT hardcode `#efece6`/`#262320` any more than
      `#ffffff`/`#121110`; the round-1 defect was exactly a hardcoded (and wrong) binding pair.
      State in-file that the 3:1 window (width **0.0953**, L in [0.1516, 0.2468]) depends on the surface set.
      **HEL-866 is open on light `--app-surface-raised` == `--app-surface-strong` == `#ffffff`**, which is
      why the light binding surface is `--app-surface-soft`. If the surface set changes, this guard must go
      RED rather than assert a stale bound. Verify: change a surface in a scratch copy and confirm it reacts.
- [x] 4.3 State in-file what the guard PROVES (every preset clears 3:1 against every declared surface in
      both themes) and what it CANNOT (that the ring is actually *painted* on a focused element — task 5
      covers that). If anything must be pinned, use **HEL-442's expiring-exception construction**; an
      exception that cannot expire is the defect that gate spent three rounds establishing.

## 4b. The static value — what actually paints first

- [x] 4b.1 Declare `--app-focus-ring-color`'s **static** value in `theme.css` as the derived ring colour for
      **`DefaultAccentColorByTheme.dark`** (`theme.ts:12-15`, `#f97316`) → **`#db6513`** (design.md D6).
      NOTE the symbol is `DefaultAccentColorByTheme` and it is THEME-AWARE (dark `#f97316`, light `#ea580c`);
      there is no `DefaultAccentColor`. Dark is chosen because `getInitialTheme` falls back to `"dark"`, and
      `#db6513` clears 3:1 in BOTH themes (light 3.03, dark 4.38) so the floor holds whichever paints first. This is not cosmetic: it is what renders on **first paint**
      (`ThemeProvider.tsx:89-92` applies tokens in a `useEffect`, which runs after first paint) and on the
      **unparseable-hex fallback** (`buildAccentTokens` returns `{}`, so nothing is written inline).
      Declare it **ONCE at `:root`**, never per theme — the value is theme-independent by construction, and
      a per-theme declaration would be the same dead-code pattern task 3.1 removes.
      Verify: a test asserting the static value equals the derivation applied to
      `DefaultAccentColorByTheme.dark`, so the static and runtime paths cannot drift. RUN the mutation
      (change one of them) and confirm RED — with a name that does not exist the test would have had no
      well-defined right-hand side and could not have failed.
- [x] 4b.2 The guard (task 4.1) must cover the static value too, not only runtime-derived ones. Otherwise
      the spec scenario "the shipped default is not an exception" is untraceable at first paint.

## 5. Real-browser evidence — the verification IS the work

- [x] 5.1 **CONTENT SELF-AUTHENTICATION FIRST.** `curl` port 6478 for a string that exists ONLY on this
      branch — **not a TypeScript type** (Vite strips types, so it reads as a failure for the wrong reason).
      **The shared browser is contested**: two lanes have independently reported a peer Playwright session
      stealing the tab. Re-check `location.href` before EVERY reading and discard hijacked ones.
- [x] 5.2 **MEASUREMENT TRAP — let the theme settle.** A too-fast probe (800–1200ms) intermittently reads
      the light accent as the dead `#ea580c`, because `ThemeProvider`'s server-preference adoption has not
      resolved at first paint — **and that reading appears to CONFIRM a claim HEL-444's design round 1
      already retracted**. Wait for the settled value and self-authenticate it rather than trusting timing.
- [x] 5.3 Measure the ACTUAL painted ring by computed style on a genuinely focused element — not the token
      value, and not by eye. Compute its contrast against the surface it lands on.
- [x] 5.4 **Two presets end-to-end, chosen ADVERSARIALLY, not conveniently**: **Yellow** (largest adjustment,
      28%, thinnest margin) and **Orange** (the shipped default that motivated the Urgent). Both themes.
- [x] 5.5 **Size from RENDERED surfaces, not the 41 static grep sites.** HEL-444 found Dashboards, Sources,
      Pipelines and Connectors render ZERO accent instances. Read HEL-444's task 4.2 inventory from
      `.concertino/runs/HEL-444/evidence/` rather than re-deriving from grep. **Do not modify lane C's
      parked worktree** (`task/light-dark-parity-audit/HEL-444` @ `a3a0e7f2`) — read only.
- [x] 5.6 Screenshots (both themes, both presets, focused element visible) to
      `.concertino/runs/HEL-1046/evidence/` ONLY — never `openspec/**`, never `git add -f`.

## 6. DESIGN.md

- [x] 6.1 Add a §8 entry recording the **DERIVATION, not just the token**: that `--app-focus-ring-color` is
      computed as the minimum adjustment clearing 3:1 against the worst surface in both themes, and that its
      justification is being derived rather than chosen. **Without this the next editor treats it as a
      palette value, hand-tunes it toward brand, and silently re-couples the two obligations** — the exact
      failure this design prevents. Say that a focus indicator carries a 3:1 non-text obligation a
      decorative accent does not.

## 7. Gates and handoff

- [x] 7.1 Run lint, typecheck, `npm test`, format:check **from `frontend/`** — root `npm test` is
      `jest --passWithNoTests && npm --prefix frontend test`, which in a worktree root turns silence into a
      pass. State what you ran and what it scanned.
- [x] 7.2 `theme.css` is policed by THREE existing guards — `check:tokens` (HEL-1037), the HEL-441 motion
      guard, and HEL-442's elevation/radius guard. All must stay green. Verify every `var(--*)` introduced
      resolves against `theme.css` BY NAME.
- [x] 7.3 For EACH guard state what it PROVES and what it CANNOT, and make it failable by mutation — RUN the
      mutation, confirm it landed, watch it go red. If a check structurally cannot fail, say so and DO NOT
      add it.
- [x] 7.4 Answer the two-axes question in `files-modified.md`: what does no source text carry, and what path
      did the gates not exercise?
- [x] 7.5 **Do NOT touch HEL-1048's scope** (accent-as-text / the "Create one" link) even though it is now
      in v0.7 alongside this ticket. The accessibility floor is settled; the identity call is not, and
      merging them would let the second decision ride in on this one's evidence.
- [x] 7.6 Re-verify **HEL-1048** is live and OPEN with a matching title before the PR.
- [x] 7.7 Re-check `origin/main` hasn't moved; if it has, rebase and RE-RUN the 5.4 measurements — stale
      readings do not establish contrast against a moved baseline.
- [x] 7.8 Write `files-modified.md` (every path in FULL, bullet-prefixed) and COMMIT.
