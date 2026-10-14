## Context

`scripts/check-scala-quality.mjs` `scanScalaText` is line-based. Per non-exempt line it pre-filters with `fqnLineRegex`,
then builds `stripped` by (1) replacing every `"(?:[^"\\]|\\.)*"` with `""`, (2) deleting single-line `/* */` spans,
(3) deleting a trailing `//` comment, and matches `fqnLineRegex` again. Step (1) cannot tell `s"..."` from `"..."`, so
splice code is blanked with the text. `scripts/check-scala-quality.selftest.mjs` drives `scanScalaText` with red/green
fixtures plus one CLI spawn, and runs first in `npm run check:scala-quality` (husky pre-commit and CI).

## Goals / Non-Goals

**Goals:** splice code is checked (also across lines); plain text stays exempt from the NEW pass; `$ident`/`$$` handled;
red-first selftest; HEAD flags every line the base guard flagged (C4/C5).

**Non-Goals:** changing pass 1 in any way (it is the base guard, byte-identical in behaviour, so its quirks - the `'"'`
char-literal false negative and the per-line matching of multi-line `"""` text - are inherited, not fixed); making
pass 2 perfect on exotic shapes (see Decision 5); any prefix-list or exemption-rule change; a baseline mechanism.

## Decisions

1. **Two passes, "old OR new" (owner reframe, C5).** Three review rounds each found a new way the first design - ONE
   scanner replacing the regex blanking, with cross-line literal state - desynced (closer mistaken for opener, a
   multi-line splice, a nested crossing `"""`, a `"""` hidden in or next to a block comment) and silenced code the
   base guard flagged. Each fix added state and a new desync; the structural problem was that the new scanner REPLACED
   the old decision. The owner chose: pass 1 is the base guard (609e62b6d) restored with unchanged behaviour; pass 2 is
   a separate splice scan; a line is flagged if either flags it, deduplicated by line (pass 1's report and column win
   when both hit; pass 2's column - an index in its splice-only view - is used when only pass 2 hits). HEAD is a
   superset of base by construction, so a pass-2 desync can lose only splice findings, never base findings.
2. **Pass 2 returns a splice-only view.** `spliceCodeOnly(line, state)` returns a string of the SAME length in which
   only code inside `${...}` splices is kept and everything else (ordinary code, string text, comments) is spaces; the
   FQN regex runs on that view. Pass 2 therefore cannot flag plain string text, `$ident` or `$$`, so
   `ShareTokenGenerationSpec.scala` :45/:56 stay unflagged.
3. **Interpolator detection.** A `"` opens an interpolated literal iff the character right before it is an identifier
   character (`s`, `f`, `raw` and custom interpolators all covered). Inside one: `\x` skipped, `$$` and `$"` are text,
   `$ident` blanks the identifier, `${` opens a splice. A run of 4+ quotes closes a `"""` at its last three.
4. **Pass-2 state is a stack that survives line breaks:** literal frames, splice frames (with brace depth) and
   comment frames. A `${` left open at end of line resumes as code at its depth; a `"""` nested in a splice restores the
   enclosing frame when it closes; `"` frames are cut at end of line. Comments (`//`, `/* */`, multi-line) are tracked
   inside pass 2 itself, independent of pass 1's skip rules, so a `"""` in a comment cannot push a literal frame.
   Simple char literals (`'x'`, `'\x'`, `'\uXXXX'`) are skipped so `'}'` / `'"'` in splice code do not unbalance it.
   Unterminated input degrades safely (never throws).
5. **Pass-2 limits are documented, not fixed:** backtick identifiers containing `"`, exotic char literals, and a `"""`
   opened after code on a `//`-truncated line. They can only lose splice findings.
6. **Dropped pins.** The earlier single-scanner green pins that contradict byte-identical pass 1 are replaced: C1 (`$"`
   is text), text after a closed multi-line splice, an FQN on an inner `"""` text line, a closer line with only text
   before `"""`, and an unclosed-`"""` text line are all FLAGGED by base pass 1 (base false positives that must stay so
   HEAD is a superset). They are now pinned as "pass 2 is silent" (the new behaviour never misreads them) plus "pass 1
   keeps flagging" for two. C2 (splice on an unclosed-`"""` opener line is checked) still holds via pass 2, as does the
   char-literal-in-splice case. The old `'"'` pin (a documented base false negative) is not asserted: pass 1 is base.
   The "code after a closer following a comment-looking text line" red case is dropped: base skips an `import` line
   inside a literal and misses it, an inherited pass-1 false negative.
7. **Report format unchanged** (`rel:line:col: inline FQN '<prefix>…' — ...`).
8. **Existing violations:** the whole-repo scan is clean (pass 2 adds nothing on the real tree); there is no baseline.
   `ShareTokenGenerationSpec.scala` stays untouched and unflagged.
9. **Header comment** documents the two passes, pass 1's inherited limits and pass 2's own limits.

## Risks / Trade-offs

- [False positives from mis-detected interpolators, e.g. `x+"..."`] → only an identifier char directly before `"`
  counts; `+"`, `("`, ` "` are plain literals. Selftest covers `foo("java.time.Instant")` staying green.
- [A real repo site now fails pre-commit for every lane] → task 2 scans the whole repo first and fixes in this change.
- [Selftest no longer proves anything if the scanner is wrong] → red-first transcript against the unmodified guard,
  plus a mutation (splice copy disabled → selftest red) recorded as evidence.

## Planner Notes

- Self-approved: covering any `id"` interpolator (not only s/f/raw) — Scala lexes every `id"..."` as interpolation, and
  narrowing would re-open the blind spot for custom interpolators. No new dependency; no product behaviour change.
