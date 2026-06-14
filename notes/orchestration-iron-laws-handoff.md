# Handoff — Autonomous "Iron Laws" for the Orchestration Flow

> **Status:** ✅ v1 COMPLETE (2026-05-29, merged PR #179) + ✅ v1.1 (2026-06-13).
> First real run (HEL-267, merged PR #181) validated the topology; three mechanism
> signals fixed (design budget 2→3 + reviser discipline, `SendMessage` resume
> fallback, archive `TBD`-Purpose fill) — see "v1.1 — fixes from first real run".
> **Goal:** Elevate the Linear ticket-delivery orchestration so it's diligent, structured, and self-correcting enough that Matt can stay _out of the loop_ until a genuine high-level decision is needed — eventually running a fleet of orchestrators, each delivering full projects.
> **Last session:** 2026-06-13.

## DESIGN.md accuracy — verified (2026-05-29)

- `DESIGN.md` was seeded by a subagent survey, then **verified directly against
  source**. The survey was **accurate**: `src/theme/theme.css` and `src/shared/
{ui,chrome}` exist; `--app-*` colors, `--space-1..10`, the `--text-micro..3xl`
  scale, Space Grotesk / JetBrains Mono, and RGL breakpoints 1440/1100/768/0 all
  confirmed. Two token-name errors in the first draft were corrected: radii are
  `--app-radius-{sm,md,lg,pill}` (4/6/10/9999) and shadows are
  `--app-shadow-{soft,card}` (not the `--radius-*`/`--shadow-*` I'd guessed).
- **Process note (the real lesson):** mid-session I briefly mis-concluded the
  survey was "hallucinated" — that was a _false alarm_ caused by a transient
  tooling glitch (garbled bash stdout, a spurious empty `find`, Read failing on a
  bad cwd). I almost acted on it (slapped a DO-NOT-TRUST banner on DESIGN.md).
  Corrected once clean reads worked.
- **Design lesson for the plugin (important, sharpened):** verification _itself_
  can be wrong under flaky tooling. A law isn't "verify once" — it's **require
  stable, reproducible evidence before drawing a conclusion; when results look
  contradictory, re-run rather than act on the first alarming read.** Applies to
  the Skeptic too: a single cold check that contradicts prior state should
  trigger a re-check, not an immediate verdict. Still want the input-side law:
  subagent findings (e.g. a surveyor's) should cite verifiable ground truth
  (real file:line) so they're cheaply re-checkable.

## Progress log

- **2026-05-29 (session 2):** forks resolved → **docs-first**, **Sonnet**
  Skeptic, **DESIGN.md only** (no reference screenshots yet). Surveyed the
  frontend and wrote the first three canonical docs:
  - `DESIGN.md` (repo root) — design-language standard, seeded from a frontend
    survey. Token foundation is more complete than expected: color (`--app-*` in
    `src/theme/theme.css`), spacing (`--space-1..10`), a real type scale
    (`--text-micro..3xl`, Space Grotesk / JetBrains Mono), radius/shadow all
    exist and are mostly honored. Doc codifies them as binding and flags **OPEN
    DECISIONs** for Matt — see the "curation queue" at the bottom of `DESIGN.md`.
    (Note: the first DESIGN.md draft was written before the survey returned and
    had several wrong guesses — token names, breakpoints, a non-existent Button
    component; it was rewritten against the survey.)
  - `.claude/laws/systematic-debugging.md` — Iron Law: no fix without a
    probe-confirmed root cause. Bound to executor.
  - `.claude/laws/verification-before-completion.md` — Iron Law: no completion
    claim without fresh pasted evidence. Bound to executor + evaluator.
  - Rules in these docs are tagged **[mechanical]** (lint/grep-checkable, cheap
    evaluator/lint enforcement) vs **[judgment]** (Skeptic's domain).

---

## Origin

Inspired by [obra/superpowers](https://github.com/obra/superpowers) — a coding-agent methodology built around composable "skills" and hard behavioral gates ("Iron Laws"). We want to **keep OpenSpec** as the spec manager and adapt superpowers' _guardrail ideas_ into our own orchestration flow — without taking a runtime dependency on it.

Superpowers skills referenced (for attribution + inspiration):
`brainstorming`, `test-driven-development`, `systematic-debugging`,
`verification-before-completion`, `using-git-worktrees`,
`requesting/receiving-code-review`, `subagent-driven-development`,
`dispatching-parallel-agents`, `writing-plans`, `executing-plans`.

We already independently have the _scaffolding_ equivalents (worktrees, OpenSpec
plans, two-stage review, warm-resume subagents). What superpowers adds is **hard
evidence-gated behavioral laws**, phrased as refusals.

---

## Core thesis (the reframe)

**The human in superpowers' loop is mostly doing _verification_, not judgment** —
confirming an artifact exists and matches reality ("yes that test failed," "yes
the server's up," "yes the design is sound"). Checking evidence against ground
truth is mechanizable.

> For each Iron Law, replace "human confirms Y" with **an evidence artifact Y + a
> cold checker that verifies Y against reality.** The human survives only for the
> residue: real decisions and tiebreaks.

**Why superpowers self-corrects with the human out of the loop** — three
structural properties, none requiring a human:

1. **Canonical procedures, re-read just-in-time** (not recalled from drifting/compacted context).
2. **Evidence-gated transitions** (a wrong step fails _loudly_ instead of propagating silently).
3. **Fresh, cold readers** (a sub-reader checks an artifact with no shared context, so it can't inherit the originator's hallucination).

**Matt's empirical proof of the mechanism:** code quality jumped _significantly_
once agents were forced to read `CONTRIBUTING.md`. That validates property #1 in
our own repo. So the plugin is essentially:

> **A set of canonical law-docs + agents bound to read the relevant one at the
> right moment + evidence checks that the law was followed.**

**Matt's pain points** (≈ equal blast radius) are mostly _property #1 failures_ —
the orchestrator hallucinating procedure (where to make a worktree, how to spin up
the dev server, the root cause of a bug) and **design inconsistencies slipping
through review.**

---

## Decisions locked this session

1. **Skeptic = a separate, COLD, adversarial verifier** — NOT folded into the
   evaluator. The differentiator is **coldness + adversarial posture**, not model
   tier (both are Sonnet as of 2026-05-29). A fresh reviewer can't inherit the
   loop's blind spots or rubber-stamp impressions formed in earlier cycles.
2. **Dependency-free Helio laws** — hand-rolled, tuned to Helio, eventually rolled
   into their **own plugin**. No runtime dependency on superpowers.
3. **Attribution is important** — credit superpowers explicitly (see below).
4. **Design inconsistency is a first-class pain** — equal priority to the
   procedural hallucinations.
5. **`CONTRIBUTING.md`-style canonical docs are the proven lever** — generalize
   that pattern rather than inventing new mechanisms.

---

## The design

### 1. Canonical procedures as scripts, not orchestrator prose

Move every "how-to" out of `linear-orchestrator.md` prose into committed,
idempotent scripts under `scripts/orchestrator/` (worktree creation, port
derivation, CORS-aware dev-server startup, archive, cleanup). The orchestrator
_calls_ them — nothing left to hallucinate. Each script prints a machine-checkable
token (e.g. `READY: worktree=<path>`). This is the biggest lever for the
procedural pain and it _shrinks_ the orchestrator prompt.

### 2. Phase postconditions as assertions

One shared `assert-phase.sh <phase> <worktree>` checking observable state required
to _leave_ a phase (worktree exists at expected path, `.env` present,
`curl /health` green, branch pushed, PR exists). Orchestrator can't transition
until green. The autonomous version of a human glancing and saying "yep."

### 3. Canonical law-docs (the CONTRIBUTING.md pattern, generalized)

- **`CONTRIBUTING.md`** — already exists, already works (code quality). Keep binding the executor to it.
- **`DESIGN.md` (NEW)** — the _missing_ analog for UI/design. The reason design
  inconsistencies leak: there's no explicit external standard, so review asks a
  weak model to _infer_ the pattern and judge against the inference. Seed it by
  having an agent survey the _current good_ frontend and codify the de-facto
  design language (spacing scale, type scale, theme tokens — light/dark via
  `ThemeProvider`, grid breakpoints, "reuse component X vs. reinvent"), then Matt
  curates. **Bind the UI reviewer to read it first.**
  - **Lean kicker:** push as much design consistency as possible into
    _deterministic gates_ — "no hardcoded hex outside theme tokens," "spacing uses
    the scale," "no ad-hoc font sizes" are greppable / ESLint-able. Mechanical
    checks (reliable even for a small model / a lint rule); leave only true
    _visual_ judgment for the Skeptic.
- **`systematic-debugging` law-doc (NEW)** — Iron Law: _"no fix until a minimal
  probe confirms the hypothesis."_ Executor reads it, records the probe command +
  output in its handoff. Evidence check is then cheap/mechanical (confirm a
  probe-output artifact exists and predicts the symptom). **No dedicated agent** —
  spawning a cold verifier mid-debug on every bug is too heavy.
- **`verification-before-completion` law-doc (NEW)** — Iron Law: _"no completion
  claim without fresh verification evidence."_ Executor pastes actual command
  output + exit codes, never prose summaries. (Evaluator already independently
  re-runs gates — strongest form — keep that.)

### 4. The Skeptic: separate cold adversarial agent — the autonomous final sign-off

- **Model:** Sonnet (resolved 2026-05-29 — fleet speed over opus's marginal edge),
  **multimodal** for screenshot-based UI judgment. Runs rarely (gates only).
- **Cold every time:** fresh spawn, given only pointers to ground truth (files,
  commands, screenshots) — never the orchestrator's narrative. Immune to
  context-borne hallucination.
- **Division of labor vs. evaluator:**
  - **Evaluator (Sonnet, warm, every cycle)** = iteration partner. Runs gates,
    walks _mechanical_ checklists, files change requests. **UI role is the
    objective:** console errors, failed network requests, broken/empty/loading
    states, ARIA presence, breakpoints that don't break layout, greppable
    design-token rules. **Subjective "does this look right" is deferred to the
    Skeptic** — not because the evaluator's model is too weak, but because a warm
    reviewer that's seen the work evolve rubber-stamps its own earlier impressions.
  - **Skeptic (cold, powerful)** = exit gate. **Evaluator PASS no longer means
    "deliver" — it means "ready for the Skeptic gate."** On PASS → orchestrator
    spawns Skeptic cold; **CONFIRM → delivery, REFUTE → findings become change
    requests back into the loop (bounded).** One powerful gate at loop _exit_
    without making every cycle expensive.
- **Skeptic UI judgment:** takes **actual screenshots** of each changed view and
  judges against `DESIGN.md` (+ optional reference screenshots) — spacing, type
  scale, token usage, component reuse, dark/light parity. Pixels-vs-standard, not
  a11y-tree-vs-checklist.
- **Also invoked once after planning** as a **design-soundness gate** (placeholders,
  contradictions, scope creep in OpenSpec `proposal.md`/`design.md`). Catching a
  bad design in planning ≫ cheaper than discovering it in cycle 3.
- **Budget:** ~2 cold Skeptic calls per ticket (post-planning + at evaluator-PASS).

### 5. Escalation taxonomy + circuit breakers (what makes the fleet safe)

Escalate to human ONLY when: (a) a real design/scope/cost decision, (b)
worker↔Skeptic can't converge after N rounds, (c) missing external input
(creds, product call). Everything else resolves in-loop. Every loop (eval cycles,
debug attempts, server-start retries) gets a **bounded counter + a defined
escalation** — never thrash forever, never silently give up. For a fleet, "fails
loudly into a known escalation state" is the property being bought.

### 6. Minimal orchestrator memory

Orchestrator holds _only_ IDs, paths, counters (`workflow-state.md` — already
exists, push further). Re-derive every procedure from scripts/files at point of
use. Compaction can't drift what isn't held as prose.

---

## Attribution model (important to Matt)

Clean, generous, and _true_ boundary:

- The **laws** (TDD, systematic-debugging, verification-before-completion,
  brainstorming) are **inspired-by** superpowers.
- The **orchestration** (Linear + OpenSpec + worktree fleet + executor/evaluator/
  Skeptic topology + escalation taxonomy) is **original** — superpowers has no
  orchestrator.

Two-level credit:

1. **Per-doc frontmatter** in each law-doc: `inspired_by: superpowers/<skill>` (+ link).
2. **README "Acknowledgements / Prior Art"** section in the plugin naming which
   laws map to which superpowers skills.

---

## Relevant existing assets

- **Agents:** `.claude/agents/linear-orchestrator.md`, `linear-executor.md`,
  `linear-evaluator.md`.
- **Commands:** `.claude/commands/` — `linear-ticket-delivery`, `opsx-*`.
- **Own skills already useful:**
  - `/run` = the canonical "how to launch this app" procedure → should _be_ the
    dev-server step (#1), replacing hand-rolled startup duplicated in orchestrator
    - evaluator.
  - `/verify` = a completion-evidence skill → component for the final gate.
  - `/code-review`, `/security-review`.
- **Binding doc:** `CONTRIBUTING.md` (the proven lever).

---

## Forks — RESOLVED 2026-05-29

1. **Skeptic UI ground truth:** **DESIGN.md only** to start; add reference
   screenshots later only if prose proves insufficient.
2. **Skeptic model:** **Sonnet** (fleet speed over opus's marginal judgment edge).
3. **v1 ordering:** **docs-first.**

## v1 plan + status

1. ~~Write `DESIGN.md`~~ ✅ (draft; awaiting Matt's curation of OPEN DECISIONs).
2. ~~Write `systematic-debugging` + `verification-before-completion` law-docs~~ ✅.
3. ~~Bind the agents to the new docs~~ ✅ (2026-05-29):
   - `linear-executor.md`: step-1 context now reads both law-docs + `DESIGN.md`
     (frontend); gate-failure/debug path bound to systematic-debugging
     (probe-confirmed root cause + 2-attempt circuit breaker); gate results must
     be pasted output per verification-before-completion; guardrails updated
     (laws re-read at point of use even on resume).
   - `linear-evaluator.md`: Phase 2 reads `DESIGN.md` (frontend) + enforces the
     [mechanical] token rules with file:line; Phase 3 narrowed to objective checks
     with **subjective visual judgment explicitly deferred to the Skeptic**;
     breakpoints corrected to 1440/1100/768; guardrails bind verdict to fresh
     evidence.
4. ~~Convert worst procedural prose → `scripts/orchestrator/`~~ ✅ (2026-05-29).
   Created `scripts/orchestrator/{setup-worktree,start-servers,assert-phase,
cleanup}.sh` + `README.md` (contract: idempotent, `READY key=val` on success,
   `FAIL reason`+nonzero on error; `assert-phase` is the postcondition gate).
   Ports derive in `setup-worktree.sh` (5173+N / 8080+N) — single source of
   truth. **Fixed a latent gap:** the `.env` copy the evaluator assumed the
   orchestrator did was never actually in the orchestrator's prose — now explicit
   in `setup-worktree.sh`. Wired both agents to call the scripts + assert gates
   (orchestrator Setup/Phase2-ports/Delivery-push/Phase4-cleanup; evaluator
   Phase-3 dev-server). Delivery squash/archive/PR left as prose (content, not
   procedure) — possible future `archive-change.sh`.
   **Not yet runtime-tested** — scripts written but not executed end-to-end
   (tooling was flaky this session). Validate on the next real ticket run.
5. ~~Define + wire the cold **Sonnet Skeptic**~~ ✅ (2026-05-29).
   `.claude/agents/linear-skeptic.md` (model: sonnet, cold/fresh every spawn,
   adversarial default-skeptic posture, multimodal + Playwright). Two gates:
   - **design** (after planning, before execution): refutes placeholders,
     contradictions, ambiguity, scope drift, missing contract updates.
   - **final** (after evaluator PASS, before delivery): traces each AC to
     evidence, re-runs gates itself, checks Iron Laws actually followed, and —
     its signature job — **subjective UI/design judgment via screenshots vs
     DESIGN.md** (token usage, component reuse, light/dark parity). The warm
     evaluator defers this; the cold Skeptic owns it.
     Wired into orchestrator: Phase-1 step 8 (design gate, 2-round budget),
     Phase-2 final gate (PASS no longer delivers — Skeptic must CONFIRM first;
     REFUTE → executor fix → re-run Skeptic, 2-round budget). Added Signal-types
     rows (CONFIRM/REFUTE), workflow-state fields (SKEPTIC_CYCLE,
     LAST_SKEPTIC_VERDICT), guardrails (deliver needs eval PASS **and** Skeptic
     CONFIRM; Skeptic always fresh, never SendMessage). Executor input generalized
     to accept Skeptic change requests via `EVALUATION_REPORT_PATH`.
     Design choice (leanness): a Skeptic-REFUTE sub-loop does **not** re-run the
     evaluator — the Skeptic re-runs the gates itself, so the two cycle budgets
     (eval ≤3, skeptic ≤2) stay independent.
     **Not yet runtime-tested** — first real ticket run validates the topology.
6. ~~Escalation taxonomy + circuit-breaker counters~~ ✅ (2026-05-29). Added a
   single **Escalation & Circuit Breakers** section to the orchestrator: the one
   source of truth for resolves-in-loop vs. reaches-the-human, plus a
   bounded-counter table (execution ≤3, skeptic final ≤2, skeptic design ≤2,
   executor debug ≤2, server start 1 → BLOCKER). This is the contract that makes a
   fleet safe to run unattended.
7. ~~Attribution — plugin README~~ ✅ (2026-05-29). `.claude/laws/README.md`:
   documents the laws, the mechanism, and an **Acknowledgements / Prior Art**
   section crediting obra/superpowers per-law, while drawing the honest boundary
   (laws inspired-by; orchestration original). Per-law frontmatter already carries
   `inspired_by`. The `.claude/laws/` dir is the portable core to spin into a
   standalone plugin later.

## v1 COMPLETE (2026-05-29)

All seven v1 steps done. Also: evaluator bumped haiku→Sonnet (Max plan); the
evaluator/Skeptic split re-grounded on cold-vs-warm + adversarial posture rather
than model tier (the more durable rationale). **Nothing runtime-tested yet** —
theory is sound and Matt has battle-tested both the base orchestrator flow and
superpowers separately; first real ticket run validates the integrated topology.

## v1.1 — fixes from first real run (HEL-267, 2026-06-13)

First end-to-end run (bug ticket HEL-267, merged via PR #181) validated the
topology: design Skeptic REFUTE×3 → bounded escalation → human-approved fix →
execution → evaluation PASS → final Skeptic CONFIRM → cleanup. Three mechanism
signals surfaced and were fixed:

1. **Design-gate budget 2→3, plus reviser discipline.** The gate burned all its
   rounds on one stuck change request the orchestrator kept failing to resolve.
   Bumped the design budget to 3 (design iteration is cheap), made the reviser
   treat each numbered required revision as a checklist, and added an
   escalate-early rule: if the _same_ change request survives a round it was
   believed fixed, escalate that item immediately rather than burning rounds.
   (Final-gate budget stays 2 — final REFUTEs are expensive, costing exec cycles.)
2. **`SendMessage` resume fallback.** `SendMessage` was not enabled in the
   harness context driving this run, so the orchestrator couldn't be warm-resumed
   for the escalation answer or for cleanup. Documented the fallback in both the
   orchestrator and the `/linear-ticket-delivery` command: re-spawn fresh with a
   `RESUME — do not start over` prompt pointing at `workflow-state.md`. Works
   because all loop state is persisted; it resumes rather than restarts.
3. **Archive leaves `TBD` Purpose stubs.** `openspec archive` writes a
   `TBD - created by archiving change ...` placeholder into every synced spec
   (57 such stubs already on main — pervasive, not HEL-267-specific). Added a
   Phase-3 step that fills the just-synced spec's Purpose from the proposal
   before committing. Did **not** add a blocking `check:openspec` rule (would
   fail on all 57) or mass-backfill — that's an optional separate cleanup.

### Possible v2 / follow-ups

- Optional: backfill the 57 pre-existing `TBD - created by archiving` Purpose
  stubs under `openspec/specs/`, then add a `check:openspec` rule to block new ones.
- Run more real tickets end-to-end (esp. a frontend one to exercise the Skeptic's
  UI judgment against DESIGN.md); fix whatever the scripts/gates get wrong in situ.
- Promote DESIGN.md [mechanical] rules into actual ESLint/stylelint rules once
  Matt curates the open decisions (intent colors, weight tokens, breakpoints,
  overlay token, Button component, focus-ring offset).
- Input-side law: subagent findings (e.g. a surveyor's) must cite verifiable
  ground truth (file:line) and be Skeptic-recheckable — the lesson from the
  survey false-alarm this session.
- TDD law-doc (red-green) + executor binding, if test-first proves worth enforcing.
- `archive-change.sh` for the mechanical delivery steps.
- Extract `.claude/laws/` + agents + scripts into a standalone plugin.

6. Escalation taxonomy + circuit-breaker counters in the orchestrator.
7. Attribution: per-doc frontmatter (✅ on the two law-docs) + plugin README
   "Acknowledgements / Prior Art".

## Matt's curation queue (from DESIGN.md)

Resolving these upgrades rules from "proposed" to enforced (and unlocks real
lint rules):

1. **Centralize intent colors** — `--app-success/warning/error` live only in
   `toast.css`; other code uses `--app-danger` + conflicting hardcoded fallbacks.
   Promote a canonical set into `theme.css` and migrate offenders.
2. **Weight tokens** — add `--weight-{normal,medium,semibold,bold}` (weights are
   raw literals today).
3. **Breakpoints** — confirm 1440/1100/768 canonical + mirror CSS media queries
   (drop ad-hoc 600/480).
4. **Overlay/scrim token** — add `--app-overlay` for the modal backdrop?
5. **Button component** — consolidate fragmented button classes into a shared
   `Button` (biggest consistency win).
6. **Focus-ring offset** — standardize `outline-offset` (varies 1/2/3/-2px).
