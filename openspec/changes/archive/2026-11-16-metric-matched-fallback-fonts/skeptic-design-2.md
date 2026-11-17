## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 7d9b2ea2d47f9ed0c57dddfdaf4fcfb4dd90317d. The change dir is untracked and contains planning only.

### What I verified (with evidence)

- **Round 1 CR 1 (CI premise) is addressed.** D5 now defines the CI-like environment as noble 1.55.1 plus `fonts-dejavu`, with Liberation kept. It states that the face CI uses after this change is the Liberation-matched one. It requires proof of the platform font through CDP `CSS.getPlatformFontsForNode`, and it adds run (3), head with DejaVu only. D6 says the CI assertion runs against the Liberation face. The home-page delta now names "the CI-like font set (Ubuntu noble with Liberation and DejaVu installed...) and with DejaVu as the only fallback". This matches the reasoning in round 1 (Playwright `tools` group -> `fonts-liberation`).
- **Round 1 CR 2 (VIEWPORTS) is partly addressed.**
  - D5(1), D6 and task 2.2 now say that 620 and 1024 are already present. I confirmed this at `e2e/hel1665-home-phone-stability.spec.ts:35-37`.
  - D5 step 6 and task 2.4a measure 610x900 in envs (1) and (2).
  - The fallback branch for an unclosed band is still wrong. See CR 1.
- **Round 1 CR 3 (box-match acceptance signal) is addressed.** D6a and task 2.4b specify:
  - the sample: the default opening sentence plus a pangram;
  - the sizes: 16px and the shelf-heading size;
  - the weights: 400, plus 600 if D2 adds bold faces;
  - `line-height: normal`;
  - the faces and environments: Liberation on the host and in docker env (2), DejaVu in env (3);
  - the thresholds: 2% on width and 1px on height.
- **Round 1 non-blocking notes were taken up.** D1 now names mono and serif as the Liberation/Courier and Liberation/Times families. D1 lists both full and PostScript `local()` names. D1 notes that on macOS/Windows the Arial face now comes before `system-ui`. D3 records the Fraunces `opsz` assumption.
- **The home-page MODIFIED delta is otherwise faithful to the live spec.** I ran a Python difflib comparison of the requirement block in `openspec/specs/home-page/spec.md` against the delta. The only changes are:
  - the record-only residual paragraph is replaced by the bounded-swap text and the large-font text;
  - 620x900 and 1024x900 are added to "Timeline does not move on load", which matches the live `VIEWPORTS`;
  - two new scenarios are added.

  Nothing else was dropped.
- **Theme stacks as described.** `frontend/src/theme/theme.css:20-23` declares the three `--font-face-*` stacks, with no `@font-face` rule. The design's comment that the Appearance preview cards read these raw faces inline does not conflict with D1, because `@font-face` rules are global.
- **AC coverage.**
  - AC 1 (at most 4px at every width, light and dark, CI-like) is covered by D5 (1)-(3), D6 and task 2.4.
  - AC 2 (the 0px series stays green) is covered by tasks 2.2 and 2.7.
  - Each extra from the ticket has a task, or is sent to a follow-up as the ticket's own rule allows (placeholder polish).

### Verdict: REFUTE

### Change Requests

1. **The 605-615px band: D6 contradicts the home-page delta it relies on.**
   - D6 says: "If D5 step 6 shows the 605-615 band does not close, the spec text stays narrowed to the asserted widths (it is already worded per asserted width)." That premise is false.
   - The new requirement prose in `specs/home-page/spec.md` is worded as a continuous range: "the runs card top SHALL move by at most 4px at 375-1280px ... and at those widths the hidden default sentence SHALL have the same line count in the fallback as in the web font."
   - 605-615 lies inside 375-1280. If the band does not close, an implementer following D6 would leave this text unchanged. The archived spec would then make a SHALL claim that the change's own evidence disproves.
   - Required revision, pick one:
     - (a) Reword the prose now to the discrete asserted widths, matching the "Cold-load web-font swap is bounded" scenario (375, 430, 480, 540, 620, 1024, 1280). State any 605-615 residual explicitly as a MAY, as the old text did.
     - (b) Make D6's fallback branch an explicit instruction to rewrite that sentence (and say what it becomes) if 610 does not close. Delete the claim that it is "already worded per asserted width".

### Non-blocking notes

- frontend-theme-system's "Fallback occupies the web font's box" scenario says the line-box heights "are equal", while D6a says "equal within 1px". Align the two, preferably by putting the 1px tolerance into the scenario.
- The "No download for a fallback" scenario has no explicit verification step. Task 2.1's `local()`-only `src` assertion guarantees it structurally, which is acceptable. A network-request check in task 2.6's fonts-blocked run would make it observed rather than inferred.
- The theme requirement's "within 2%" for Fraunces depends on `opsz` at Serif-heading sizes. D3's empirical tune covers this, but the 2% should be stated as measured at the D6a sizes. Otherwise it reads as a claim about every size.
