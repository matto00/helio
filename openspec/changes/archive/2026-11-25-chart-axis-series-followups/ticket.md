# HEL-1517: After HEL-1508: daily data gets hour ticks on the time axis; multi-series same x+series keeps only the last value; scatter non-numeric x plotted at 0; isolated point invisible between gaps

## Description

These follow-ups came from HEL-1508 (PR #972, e4ef70c31). It added a category fallback for same-date bars, a footnote
for rows with no readable date, and gaps for non-numeric y.

1. The HEL-1305 time axis shows hour ticks on daily data. At 375 px it can show hour labels with no day label
   (final-skeptic finding). Set a minimum tick interval from the data's granularity.
2. In a multi-series chart, two rows with the same x and series silently keep only the last value, on both axis types.
   This predates HEL-1508. Product call: sum, warn, or keep the last.
3. A non-time scatter still plots a non-numeric x at 0.
4. A line with `showSymbol: false` draws nothing for a single value between two gaps. This now affects single-series
   lines too. Show a symbol for isolated points.
5. **Test gaps:**
   * The GUARD test has no case for an {xAxis, series} mapping without yAxis (skeptic mutation M2 survived; the
     shipped code is correct for that case).
   * The hel1508 e2e check that the gap tooltip is empty has no positive control.
6. `buildChartOption.ts` is about 420 lines. HEL-1512's suggested compact-mode split is still open.

## Owner rulings (recorded by the driver, 2026-11-24)

- Item 2: SUM the values, as a group-by would, AND show a small footnote that N points were combined. Reuse the
  footnote pattern HEL-1508 added for rows with no readable date; footnote wording follows DESIGN.md.
- Item 3: excluded, consistent with how HEL-1508 treats unreadable values (derive; escalate if two plausible
  behaviours exist).
- Item 6: split only if small, behaviour-preserving and helpful to items 1-4, in its own commit; otherwise leave it and
  raise a follow-up triage.

## Acceptance criteria

- Red-first unit tests, with mutations, for each behaviour item (1)-(4).
- Item 5's GUARD case (labelled guard, failable by mutation) and the e2e positive control.
- UI check of item 1 at 375 px and desktop in both themes against the running app; item 2's footnote visible.
- Full jest suite green. Frontend only: no backend change, no migration.
