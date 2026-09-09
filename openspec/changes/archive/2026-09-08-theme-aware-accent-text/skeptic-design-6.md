## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Scope: read-only consistency sweep of `design.md` at `09dcb153`. No reachability hunt, no
re-derivation, no edits, no app run. `tasks.md` read only as a cross-check.

### What I verified (with evidence)
- `git log --oneline -1` → `09dcb153`; `design.md` is 343 lines.
- Read `design.md` end-to-end as one continuous argument (`cat -n`).
- Cross-checked the dark-adjustment figures and the `::selection`/D12 scoring costs against
  `tasks.md` lines 16-19, 45-47, 61-63, 95.

### Verdict: REFUTE

Five disagreements. Findings 1, 2 and 5 are the same append-only mechanism the document itself
names at lines 253-257.

### Change Requests

**1. D4's dark figures are the overturned round-3 numbers, still stated as current — and `tasks.md`
says so explicitly.**
- Stale (design.md:86-87): "Scoring the tinted backgrounds raises those to **+22%, +18%, +22%,
  +17%**. That is 2–9× the rendered adjustment".
- Current (tasks.md:45-47): "As of round 4 they are approximately Red **+28%**, Pink **+25%**,
  Purple **+28%**, Blue **+25%**, and critically **Orange +2% → +14%** … Earlier drafts named
  +22/+18/+22/+17; those are stale."
- The task list is right; D4's body is stale. D4 is the paragraph an implementer reads to run the
  brand gate, so the wrong figures sit in the position of authority. This also matches the round
  brief's known-current values.

**2. D3's `dark, +tinted` row is pre-D12 and contradicts D12's own conclusion.**
- Stale (design.md:80): "| dark, **+tinted** | **22%** | **22%** | **17%** | **18%** | 2% | 0% | 0% | 0% |"
  (Purple/Red/Blue/Pink/Orange…).
- Current (design.md:300): "Scoring them costs a further **+2% to +12%**, taking dark Orange — the
  shipped default — from +2% to **+14%**." And D2:51-56 now defines the scored set as *including*
  the D12 inline tints, so a row labelled "+tinted" that stops at `--app-accent-surface`/`-dim` is
  no longer what "+tinted" means anywhere else in the document.
- D12/D2 are current; D3's dark row is stale (its Orange 2% in particular). Note D3's light
  "+tinted" row (23/25/26/27/35/39/41/45) does match the brief's current values — only the dark row
  is out of date, which is exactly what makes it easy to read past.

**3. D11 contradicts itself on the dark baseline for Cyan (and on Orange).**
- design.md:206-207: "it needs light Yellow **48%** and would add dark adjustments to Cyan **23%**,
  Green **22%**, Yellow **12%** — presets **D3 currently reports as 0% in dark**."
- design.md:235-236: "Scoring it costs up to **+22 points** (dark **Cyan 3→23**, Green 0→22,
  **Orange 14→29**)." Same figure appears in tasks.md:63 and :95.
- The 235 line (Cyan baseline 3, Orange baseline 14) is current; the 207 clause "presets D3
  currently reports as 0% in dark" is stale — it is true only of the stale D3 row from finding 2,
  and it is false for Cyan under the current baseline.

**4. D12 says "All are heavier than `--app-accent-surface`" but one of its own three sites is not.**
- design.md:293: "`features/sources/ui/InlineConnectorSetup.css:38` — **10%**".
- design.md:295-296: "**All are heavier than `--app-accent-surface`** (11% light / 15% dark), so
  D2's scored set does not bound them."
- The enumeration (10%) is current; the universal claim is wrong — 10% is lighter than
  `--app-accent-surface` in both themes, and equal to `--app-accent-dim` in dark (D2:36, light 8% /
  dark 10%). The *conclusion* that the class must be scored still holds on the 22%/20% sites (and
  D12:302-304 already attributes the whole +14% to `AddSourceModal.css:84`/`:94`), so the defect is
  the blanket "all are heavier", not the ruling.

**5. An orphaned sentence fragment at design.md:259-261 — the deleted half of a superseded
paragraph.**
- design.md:259: the section resumes mid-sentence: "was false** — retained here only as the detail
  behind history note (iii). The round-3 draft said 'every percentage it forces is already forced by
  D12'…". The subject of "was false" no longer exists in the document.
- Current is history note (iii) at design.md:249-251, which already carries this content. The
  fragment at 259-261 is the residue of the replaced text and is stale; likewise 263-273 restate
  the Ruling at 229-238 (they agree, so this is duplication rather than contradiction — noted here
  only because the same replacement is what left the fragment).

**6. The site inventory's "Four background classes, not three" predates D12 and D2's completed set.**
- design.md:128-149 asserts "**Four** background classes" and enumerates neutral-backed,
  accent-tinted, `::selection`, user-chosen — the hand-rolled inline tints are absent.
- design.md:284 heads D12 "Hand-rolled inline accent tints are a **FOURTH** background class", and
  D2:51-56 now scores them as item 3 of the set.
- D12/D2 are current; the inventory's count and enumeration are stale. Since the inventory section
  is titled "every class named (AC-4)", a reader who stops there gets a set that omits the class
  whose omission "would ship dark Orange at 4.161".

### Non-blocking notes
- D3's table caption is "Cost of widening" with no statement of which background set the "+tinted"
  rows cover; once finding 2 is fixed, the row label should be unambiguous about whether D12 tints
  are included. (Identifying only — no wording proposed.)
- Within the tinted bullet, design.md:132 states "**16 rules across 7 files** (11 persistent, 5
  hover/focus-only)" while :138-139 says "a same-rule mechanical scan finds 12; the full set … is at
  least 18", and :154 says "Ten rules are hover/focus-only". These three counts are not reconcilable
  as stated, but the bullet already instructs re-derivation in task 1.2, so I am not treating the
  count as a decision in conflict. Flagging in case the fixer wants it settled in the same pass.
- Section order places D13 (line 275) before D12 (line 284). Structural only; out of scope.
