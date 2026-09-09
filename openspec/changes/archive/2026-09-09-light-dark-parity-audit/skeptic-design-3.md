## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold spawn. Every number below was recomputed by me with a brace-matched theme-block extractor over
`frontend/src/theme/theme.css` x `ACCENT_PRESETS` in `frontend/src/theme/theme.ts` and a WCAG
relative-luminance implementation — parsed, never transcribed from the artifacts. No visual observation
was required at this gate, so no dev server was started and **no provenance claim is made** (nothing here
depends on a rendered read; the runtime-inline mechanism is settled from source + rounds 1-2).

### Round 2's three blocking items — all CLOSED, verified by reading the files

**CR1 (stale retracted claim in `proposal.md`'s Why) — CLOSED.** `proposal.md:5-9` now reads "the app
renders `#f97316` as the accent in BOTH themes, and in light it measures 2.38-2.80 against every surface,
failing 3:1 as well as 4.5:1", with the retraction stated inline and pointed at D5. The retracted
per-theme-asymmetry framing is gone from the headline. `tasks.md:48` (7.2) now reads "**NOT** a per-theme
asymmetry — one accent in both themes", which is the corrected form, not the retracted word left standing.
The persisted mirror at `.concertino/runs/HEL-444/evidence/openspec/changes/light-dark-parity-audit/` is
byte-identical to the worktree artifacts (`diff -rq`: only `.openspec.yaml` differs, worktree-only) — the
mirror carries the corrections too.

**CR2 (wrong dark-theme claim) — CLOSED and numerically correct.** `ticket.md` now says all eight clear
3:1 in dark but four fall below 4.5:1. My independent recomputation of the min-over-five-dark-surfaces:
Purple **3.95**, Red **4.15**, Blue **4.25**, Pink **4.43** — exactly the four named, exactly those figures.

**CR3 (owning ticket) — CLOSED, and HEL-1046 honestly covers what AC2 defers to it.** I read HEL-1046 in
Linear (not the orchestrator's account of it). It is filed, **High**, in the v0.7 project, and it carries:
the inline-style mechanism with the correct `ThemeProvider.tsx:89-92` / `setProperty` citation; the full
8x2 measured table (which matches my recomputation row-for-row); the 3:1-vs-4.5:1 distinction and why 3:1
matters (63 border/outline uses, 41 `color:` sites); the caveat that the per-surface rendered inventory is
HEL-444's task 4.2 and must be read from its report rather than re-derived from grep; three concrete
fix-shape options; and an explicit statement that **HEL-444 declares AC2 REPORTED-NOT-SATISFIED against
it**. Its scope item 3 also absorbs the dead `theme.css` per-theme `--app-accent` / `--app-accent-ink`
defaults and the false `theme.css:161-162` comment, so D8a has a home even if task 5.1a only records it.
The deferral is real: a ticket owns it, and the ticket's content matches the deferral.

**The declaration is recorded in BOTH artifacts, as required.** `design.md:57-61` (D5 tail) — "**Owned by
HEL-1046** (filed), against which **AC2 is declared REPORTED-NOT-SATISFIED**". `tasks.md:38` (5.3) — same
declaration, with the reason (four presets fail 3:1 in light incl. the default, four fail 4.5:1 in dark)
and the requirement to name the ticket in the PR body and `DESIGN.md`. `tasks.md:48` (7.2) carries it into
the PR body. Consistent across all three.

### My own stale-copy sweep (fourth copy hunt)

`grep -rniE "asymmetr|ea580c|3\.02|3\.56|all but Purple"` across the change dir, the worktree openspec tree
and the whole persisted evidence tree (including its nested mirror). Every surviving hit is
retraction-framed ("was wrong and has been retracted", "NOT a per-theme asymmetry", "`#ea580c` never
renders") **except one**: `design.md:12`, a Goals bullet still reading "Resolve whether the light
accent-as-text **asymmetry** is a defect". That is retracted vocabulary in a line a reader hits ~30 lines
before D5 corrects it. It is a stale *word*, not a stale *claim with numbers attached* — it would not cause
an executor to build the wrong thing — so it is a non-blocking note, not a CR. Fix it anyway (note 1).
No other copy of the retracted claim survives anywhere I could find.

### The premise-validation CORRECTION — accurate and sufficient

Read in full. The appended section correctly scopes the original file's limitation ("claim 4 / AC4 covers
**ink selection only**"), states the inline-write mechanism with correct citations, notes the presets are
parsed from `theme.ts` not `theme.css`, and reproduces the light range (2.38-2.80), the four-fail-3:1 light
set, the four-fail-4.5:1 dark set, and the 63-border consequence. Every one of those figures matches my
recomputation. It correctly says nothing above it is *retracted*, only incomplete — which is true: claims
1, 2, 3, 5 and 6 in the original body are all about tokens/ink/surfaces and I reproduced them
(parity set-difference empty both directions; light muted-on-soft **4.87**; light `--app-surface-raised` ==
`--app-surface-strong` == `#ffffff`). The annotation is sufficient; a reader relying on that file will not
be misled.

### Independent recomputation (the whole load-bearing matrix)

min-max over the five surface tokens:

| preset | light | 3:1 | dark | 4.5:1 |
| -- | -- | -- | -- | -- |
| Orange `#f97316` (default) | 2.38-2.80 | **FAIL** | 5.58-6.73 | pass |
| Red | 3.19-3.76 | pass | 4.15-5.01 | **fails at min** |
| Pink | 2.99-3.53 | straddles | 4.43-5.35 | **fails at min** |
| Purple | 3.36-3.96 | pass | 3.95-4.77 | **fails at min** |
| Blue | 3.12-3.68 | pass | 4.25-5.13 | **fails at min** |
| Cyan | 2.06-2.43 | **FAIL** | 6.44-7.77 | pass |
| Green | 1.93-2.28 | **FAIL** | 6.86-8.28 | pass |
| Yellow | 1.63-1.92 | **FAIL** | 8.15-9.83 | pass |

Also reproduced: theme-block set difference empty in both directions; light `--app-text` min 14.20,
`--app-text-muted` min **4.87**; dark 13.62 / 5.21; `theme.css` per-theme accent defaults dark `#f97316`,
light `#ea580c`, inks `#16130f` / `#ffffff`. Every artifact figure is exact.

### RULING — is AC3 still honestly satisfied given accent-as-text fails?

**Yes. AC3 stands as satisfied, and there is no contradiction with the accent finding.** AC3's own wording
scopes it: "Text meets WCAG AA contrast against its surface **for body and muted text** on the primary
surfaces." `--app-accent` as a link/badge colour is neither body nor muted text; it is a brand colour, and
it is exactly what AC2 ("legible and on-brand ... across all 8 accent presets") covers — which is precisely
the AC now declared reported-not-satisfied. The two statements partition the text surface cleanly rather
than overlapping. Widening AC3 to "all text of any colour" would be me rewriting the ticket, and it would
also duplicate AC2 rather than adding anything.

Nor is it a *hollow* pass: AC3's evidence is exhaustive over its stated domain (20/20 = {text, muted} x 5
surfaces x 2 themes, thinnest 4.87), not a sample, and `ticket.md`'s AC3 row already states that domain
explicitly rather than claiming "all text passes". So the discharge hangs together: three ACs satisfied
within their stated scopes, AC2 reported-not-satisfied against HEL-1046, plus a guard and a running-app
walk. That is an honest reading, not a contradiction.

**One thing follows from the ruling** (note 2): a PR body that says "AC3: text meets AA" next to "the accent
fails 4.5:1 as text" invites exactly the reading I just rejected. Task 7.2 should require AC3's claim be
stated with its domain attached — "`--app-text` / `--app-text-muted` on the five surface tokens, 20/20;
accent-coloured text is AC2's domain and is reported-not-satisfied". Editorial, not structural.

### Anything rounds 1-2 missed

I looked for a fifth issue and found nothing blocking. Two small things, both non-blocking:

- `proposal.md` — the top-level artifact — never names HEL-1046 and never says AC2 will not be satisfied.
  Its Non-goals still say only "report it, do not decide it inside a parity audit". `design.md` and
  `tasks.md` both carry the declaration (which is what round 2's CR3 demanded and what I was asked to
  verify), so the deferral IS recorded — but the doc a reviewer opens first is the one that omits it.
- My extractor counts **29** `--app-*` declarations per theme block where the artifacts say **30**. The
  load-bearing claim — set difference empty in BOTH directions — reproduces exactly, so parity is
  confirmed regardless; the discrepancy is a regex boundary (likely a multi-line or nested-`var()` value my
  matcher folds differently). Worth reconciling when task 2.1's guard is written, because the guard will
  publish a count and a count nobody can reproduce is a weak guard. Not a design defect.

Round 2's endorsements (guard worth building, D3 enumeration, two adversarial presets, D7/HEL-866
placement, report-don't-fix, guards-over-conversions) were not re-litigated, per instruction, and nothing
I found this round disturbs any of them.

### Verdict: CONFIRM

The plan is sound enough to implement. The three round-2 items are genuinely closed against the files, the
one surviving stale artefact is a single word in a Goals bullet that a corrected D5 immediately contradicts,
HEL-1046 exists and honestly owns what AC2 defers to it, and AC3's satisfaction is correctly scoped.

### Non-blocking notes

1. **`design.md:12`** — replace "the light accent-as-text asymmetry" with the corrected framing ("whether
   the light-theme accent contrast is a defect"). Last surviving instance of the retracted word outside a
   retraction sentence. Apply to the persisted mirror copy too.
2. **`tasks.md` 7.2** — require AC3's claim be stated with its measured domain attached (see the ruling
   above), so "AC3 passes" and "accent text fails" cannot be read as contradictory.
3. **`proposal.md` Non-goals** — name HEL-1046 and state AC2 is reported-not-satisfied, so the first
   artifact a reviewer opens carries the deferral rather than only design.md/tasks.md.
4. Round 2's still-open notes remain worth acting on and were not superseded: the worktree-invisible
   `.concertino/runs/` evidence citation (cite it repo-root-absolute), the second ink-selection site at
   `appearance.ts:255-265` that D3/3.2 do not name, and stating plainly whether D8a's pre-mount frame is
   actually observable (if not, D8a is a false-comment defect — which is still worth fixing, and HEL-1046
   scope item 3 already absorbs it).
