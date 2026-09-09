## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

All computation re-derived from scratch in this round; every script and output persisted to
`/home/matt/Development/helio/.concertino/runs/HEL-1048/evidence/`. Both scripts re-run twice with
identical md5 (deterministic, not a flaky single reading).

**Method validation first.** My independent minimum-adjustment solver, scoring the five neutral
surface tokens plus `--app-accent-surface`/`--app-accent-dim` composited over each, reproduces D3's
table **exactly** — light 23/25/26/27/35/39/41/45, dark 22/22/17/18/2/0/0/0
(`skeptic2-inline-tint-cost.txt`, "tokens only" column). D3 is sound and my method matches it, which
is what makes the deltas below trustworthy.

- **D11's numbers — CONFIRMED.** `::selection { color: var(--app-text) }` over `--app-accent-mid`:
  worst light **10.312** (Red over `--app-surface-soft` `#efece6`), worst dark **7.005** (Yellow over
  `--app-surface-strong` `#262320`), using the real `#211d19`/`#f2efe9`. Surface hexes re-read from
  `theme.css:149-153`, `:199-203`, `:155`, `:205`. (`skeptic2-ink-and-selection.txt` §B.)
- **D11's "no cost" claim — REFUTED** (finding 2). See below; reproduced in a real Chromium.
- **D9's site list — CONFIRMED**, 8 declarations across the 6 named files, verbatim.
- **D10 — CONFIRMED.** `--app-info: var(--app-accent)` at `theme.css:181`/`:232`;
  `DashboardList.css:640-648` renders `color: var(--app-info)` on `background: var(--app-accent-surface)`.
- **HEL-1057 — CONFIRMED** (read from Linear). Title is *"Accent-coloured TEXT on user-chosen panel
  surfaces cannot be guaranteed at 4.5:1"*, it names `.markdown-panel a`
  (`MarkdownPanel.css:112`) explicitly, its AC is accent **text** at **4.5:1** on a user-chosen
  background, and it records why HEL-1051 does not accept the deferral. It genuinely owns the
  obligation, not merely the component. Status Backlog, Medium.
- **Ink-on-accent-fill passes today** — `--app-accent-ink` from `buildAccentTokens`' best-of-two
  scores 4.598 (Purple, worst) to 9.487 (Yellow) against its own accent fill, all 8 PASS
  (`skeptic2-ink-and-selection.txt` §A). No defect there **as shipped** — which is exactly why
  finding 2 is a regression the plan would introduce.
- **Other text routes closed out** (the hunt's negative results, so round 3 need not redo them):
  no `fill`/`stroke`/`caret-color`/`-webkit-text-fill-color`/`text-decoration-color` reaches any
  accent token in any stylesheet; `::placeholder` (`inputs.css:25-26`) and `::marker` never use the
  accent; the only SVG accent use is `OrbitMark.tsx:27,36,43` (a decorative logo mark, not
  text-equivalent, correctly out of a 4.5:1 text obligation).

### Verdict: REFUTE

The fourth class exists, and D11's round-1 fix introduces a new failure. Both are cheap to fold in
now and expensive at the final gate — which is precisely the sequencing the owner asked for.

### Change Requests

1. **(a) NEW — THE FOURTH CLASS: inline `color-mix` accent tints used as backgrounds, heavier than
   any token D2 scores.** D2's tinted set is `--app-accent-surface` (11%/15%) and `--app-accent-dim`
   (8%/10%). Three stylesheets hand-roll an accent tint inline instead, at **10% / 20% / 22%**:
   - `shared/chrome/BottomNav.css:126` — `.bottom-nav__tab--active .bottom-nav__lozenge`,
     `background: color-mix(in srgb, var(--app-accent) 22%, transparent)`, sitting directly behind
     `.bottom-nav__tab--active`'s `color: var(--app-accent)` (`BottomNav.css:118`). **Accent text on a
     22% accent tint — twice the light `--app-accent-surface`, and heavier than the dark one.**
   - `features/sources/ui/AddSourceModal.css:84` and `:94` —
     `.add-source-modal__type-btn--active{,:hover}`, `background: color-mix(… 20% …)` under the
     `--app-accent-strong` text at `:85`/`:95` that CR-1a of D9 repoints into this ticket.
   - `features/connectors/ui/InlineConnectorSetup.css:38` — 10%, text is `--app-text`, so it is a
     background class to enumerate but not a failing pair.

   This is the same shape as D9/D10/D11 and defeats the same defences: it is **not a token**, so no
   alias-resolving token scan finds it, and the *background* side is what varies, so a text-side
   inventory finds it only if the enumeration is driven by the **rendered background**, not by
   background-token names. **Cost, computed** (`skeptic2-inline-tint-cost.txt`): adding the 10/20/22%
   tints to the scored set raises the minimum producible adjustment by **+2% to +12%** —

   | | Purple | Red | Blue | Pink | Orange | Cyan | Green | Yellow |
   |---|---|---|---|---|---|---|---|---|
   | light, D2 set | 23 | 25 | 26 | 27 | 35 | 39 | 41 | 45 |
   | light, **+inline** | **29** | **32** | **31** | **33** | **39** | **43** | **44** | **47** |
   | dark, D2 set | 22 | 22 | 17 | 18 | 2 | 0 | 0 | 0 |
   | dark, **+inline** | **28** | **28** | **25** | **25** | **14** | **3** | 0 | 0 |

   Required: (i) add this class to D2's scored background set and to the AC-4 enumeration, stating
   the rule as "every rendered background composited from the accent, whether or not it is a token";
   (ii) decide per site whether to normalise these three inline mixes onto tokens (which shrinks the
   scored set) or to score them as-is — either is defensible, but the design must choose, because
   scoring 22% costs every preset real adjustment.

2. **(c) INTRODUCED BY THE ROUND-1 FIX — D11's `::selection { color: var(--app-text) }` breaks the
   accent-ink pairing.** D11 claims it "removes the entire class from the derivation problem at no
   palette cost". It does not: `::selection` is a global rule, so it also overrides the **34
   `color: var(--app-accent-ink)` sites** whose background is the bright `--app-accent` fill
   (`--app-accent-mid` is the accent composited over the accent, i.e. still the accent). Forcing
   `--app-text` there gives, per `skeptic2-ink-and-selection.txt` §C:
   - **dark theme: all eight presets FAIL** — Yellow **1.67**, Green 1.99, Cyan 2.12, Orange 2.44,
     Blue 3.20, Pink 3.07, Red 3.28, Purple 3.45 (`#f2efe9` on the raw accent fill);
   - **light theme: Red 4.45 and Purple 4.23 FAIL** (`#211d19` on the raw accent fill).

   Today those same pairings pass at 4.598–9.487 via the ink token, so this is a **regression the
   plan would ship**, not a pre-existing defect. Reproduced in a real browser, not reasoned:
   `skeptic2-selection-over-accent-fill-dark-Yellow.png` — dark theme, Yellow preset, a
   `--app-accent-ink` button label *and* a non-button accent-filled badge, both rendering near-white
   on bright yellow under selection. Note the button case is not hypothetical: Chromium applies
   `::selection` colour to button label text under a document-wide selection, and
   `.user-menu__initials` (`UserMenu.css:31-36`) is a plain accent-filled `div`.

   Required: scope the `::selection` colour so it does not override text on accent fills — e.g.
   `::selection` sets `color: var(--app-text)` but accent-filled components re-assert
   `&::selection { color: var(--app-accent-ink) }`, or the rule is scoped away from
   `--app-accent-ink` consumers. Whatever the mechanism, D11 must **score `::selection` against the
   accent FILL background too**, not only against accent-mid over neutral surfaces, and its "no cost"
   sentence must be corrected. Add the accent fill as an explicitly named background class.

3. **(a) NEW — D9's blanket repoint destroys a hover affordance.**
   `shared/chrome/SidebarBody.css:46` is `.sidebar-body__locked-notice-link { color: var(--app-accent) }`
   and `:55` is that same link's `:hover { color: var(--app-accent-strong) }`. Repointing **both** at
   the one text token (tasks 4.1 + 4.4) makes the hover rule a **no-op** — the link's colour would
   not change on hover at all, and its underline is already permanent (`:49`), so it loses its only
   hover feedback. D9's "acceptable narrowing, both are accent-family" reasoning is true of a colour
   but false of a *state pair*. Answering the orchestrator's question 2 directly: **yes, one site
   depends on `--app-accent-strong` being distinct from ordinary accent text**, and it is a state
   distinction rather than an emphasis distinction. Required: name the hover-pair case in D9 and give
   it a rule (e.g. a second derived step, or move the hover affordance to another property), rather
   than letting task 4.4 silently flatten it.

4. **(a) NEW — sibling diff chips lose their semantic separation.**
   `PipelineDetailPage.css:631-647`: `--chip--added` is `color: var(--app-accent)` on
   `--app-accent-surface`; `--chip--changed` is `color: var(--app-accent-strong)` on
   `--app-accent-dim`. After tasks 4.1 + 4.4 both chips carry the **same text colour**, distinguished
   only by an 11%-vs-8% (light) / 15%-vs-10% (dark) background tint. Required: either accept this
   explicitly with a rendered side-by-side in the evidence, or keep a distinction. Lower severity
   than 3 (the backgrounds still differ) but it is a deliberate design decision the plan currently
   makes by accident.

5. **(b) REPEAT — the wrong owning ticket is still cited, in two places.** The ticket body, the design
   inventory and task 1.4 all correctly say **HEL-1057** and warn that HEL-1051 does not accept the
   deferral. But `proposal.md` "Non-goals" still says *"**HEL-1051** owns it"*, and `design.md`
   "Non-goals" (last line) still says *"User-chosen panel surfaces (HEL-1051)"*. Round 1 fixed the
   bodies and not the Non-goals sections. This is the deferral-to-a-non-accepting-ticket mistake for
   the **third** time on this lane, and it is now the only statement an archive reader would take
   away from the proposal. Required: correct both Non-goals sections to HEL-1057.

6. **(a) NEW / partly (c) — D4's trigger is a judgement call in disguise, and its preset list is now
   incomplete.** Two problems, answering orchestrator question 4:
   - *Objectivity.* "Distinguishable from its raw accent when shown side by side at 14px on
     `--app-surface`" names the stimulus but not the decision rule — no observer, no zoom level, no
     tolerance, and "distinguishable" is exactly the judgement the trigger was supposed to remove.
     Relocating it to task 2.0 fixed the **sequencing** (a real round-1 improvement) but not the
     **decidability**. Required: pair the rendered comparison with a computed, stated threshold
     (ΔE00 between raw accent and derived text colour, with the escalate-above number written down),
     so the render supports the call rather than being the whole call.
   - *Completeness.* D4 and task 2.0 list Red/Pink/Purple/Blue. Under finding 1, **dark Orange moves
     from +2% to +14%** — a seven-fold increase, on the **shipped default accent**, in the theme the
     owner was told was imperceptible. Orange must be in the 2.0 comparison set, and the revised
     dark figures to render are 28/25/28/25/14, not 22/18/22/17.

7. **(a) NEW — task 1.2's "re-derive mechanically" does not yet specify a method that would produce a
   stable, complete set.** Answering orchestrator question 3: 1.2 correctly diagnoses that no hand
   list has been reliable (5/12/16/18) and correctly demands a script — but it does not say what the
   script keys on, and **every candidate keyed on token names would still return an incomplete set**,
   as finding 1 demonstrates. Required: 1.2 must state the method as resolving, for each accent-text
   site, the **computed background of its nearest painted ancestor on the running app**, with the
   static scan used only as a cross-check; and its output must be a committed artifact listing
   site → background → composited hex → ratio, so round 3 can diff it rather than re-count. Until
   the method is specified, "16 rules across 7 files" in D2 should be marked provisional (it already
   is, correctly) and no number should be quoted as settled.

### Non-blocking notes

- D5's producibility finding re-checked and correct: 30% of `#f97316` is `#ae510f` (4.4711, fails),
  and `#ae500f` is unreachable at any integer percent; my solver's light-Orange minimum agrees with
  the tinted-set figure. The guard in 5.2 is the right shape.
- D3's "one token per theme suffices" survives finding 1 — with the inline tints scored, every preset
  still has a producible solution (worst is light Yellow at 47%, dark Purple/Red at 28%). No second
  token is needed. The cost is brand shift, not feasibility.
- Task 9.1 correctly names the root-`npm test` `--passWithNoTests` trap.
- The `theme.css:8-9` comment ("Only `--app-accent` and `--app-accent-ink` are set at runtime") is
  already false — `--app-focus-ring-color` is written too (`appearance.ts:438`). Task 4.3 targets the
  `:161-162` comment; `:8-9` is the same defect and is cheap to fix in the same pass.
