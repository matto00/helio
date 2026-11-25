# HEL-1622: e2e: replace document.fonts.ready waits with waitForWebFonts (hel1579:261 and hel1572 specs)

## Description

origin_kind: followup
origin_ticket: HEL-1613

`document.fonts.ready` can resolve before the web fonts have loaded, while the page is still rendering in the fallback face. HEL-1613 generalised `e2e/support/webFonts.ts` `waitForWebFonts` to any element. These specs still wait on `fonts.ready`:

* `e2e/hel1579-*` around line 261
* some `e2e/hel1572-appearance-preferences.spec.ts` tests (HEL-1613 already converted the "Compact tightens overview list rows" test)

They pass in every forced font state today, so this is robustness only.

**Fix:** switch them to `waitForWebFonts`, and prove each conversion red/green with a forced font delay, the same way HEL-1613 did for hel1444 and hel1572. No tolerance or timeout changes.

## Owner rulings (premise-validation escalation, 2026-11-24, recorded escalation.answered)

1. Scope = named-4-only: `e2e/hel1579-pipeline-spine-layout.spec.ts` lines 296 and 465, `e2e/hel1572-appearance-preferences.spec.ts` lines 672 and 764 (as of main 793802e50). The other ~41 `fonts.ready` waits in e2e/ are follow-up HEL-1884 (already filed; do not touch, do not re-triage).
2. Conversion rule = convert-anyway: for each of the 4, first try a forced font delay on the pre-conversion code. First check that `page.route` still intercepts the font requests now that HEL-1757 serves the fonts from a local HTTPS server via Chromium host rules, and state which mechanism actually delays them. If it goes red, that is the red. If not, record the no-fail run as evidence labelled "no red possible", never presented as a red. Then convert.

## Acceptance criteria

- The four named `fonts.ready` waits are replaced with `waitForWebFonts(<narrowest measured container>)`; no other e2e wait, tolerance or timeout changes.
- Per converted site: a forced-delay run on the pre-conversion code (red with the failing assertion text, or explicitly labelled "no red possible" with the measured values), and the same forced-delay run with the conversion (green). The delaying mechanism is verified and named.
- Each touched spec file passes 20 times in a row (`--repeat-each=20` or equivalent, `--workers=2`, `nice -n 19`), with counts recorded.
- Note on `hel1572-appearance-preferences:126` (C11 flake candidate): say, with evidence, whether this conversion explains it; do not remove it from any list.
