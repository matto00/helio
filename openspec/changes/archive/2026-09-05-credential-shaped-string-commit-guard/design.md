# Design — HEL-846 credential-shaped-string commit guard

## Context

**Preventive, not reactive.** No real-shaped credential exists in committed history (see `ticket.md` and the run's `premise-validation.md`). This change adds the mechanical prevention that was missing; it does not remediate a leak.

Ground truth read before designing, at `main`/`66f302f5`:

- `scripts/check-no-credential-in-agent-surface.mjs` (890 lines) — a `SURFACES` table (`assistant-surface`, `fixture`, `mcp`) dispatched through one `collectFiles` + `readSurfaceFiles` + `runChecksForSurface` loop, with `assertSurfacesValid`, a coverage-drift guard over top-level directories, a vacuity check, batched access errors, and a fail-closed entry guard.
- HEL-956 (`351d0168`) and HEL-993 (`66f302f5`) together found **seven** defects in that gate. Every one produced a confident OK over unexamined code. **None was found by reading the source — all by mutation.** That sets this run's evidence bar: a mutation must be *run*, and its transcript pasted.

Two facts in that script's own text point at this ticket by name: the header states generic token-shaped secrets "ANYWHERE agents write files during delivery are HEL-846's guard, not this one", and both the `scripts` `ACKNOWLEDGED_UNSCANNED` reason and the `backend` `PARTIAL_COVERAGE` reason say "HEL-846 is the intended generic backstop".

## Decision 1 — Detect-and-block, never redact-in-place

**Chosen: detect and block. The gate fails the commit/CI run and names the file and line; it never rewrites a file.**

Reasoning:

1. **Silent rewriting destroys the artifact that made the finding legible.** An evidence transcript is the record a reviewer uses to judge whether verification actually happened. A tool that edits it out from under the author produces a file that no longer matches what was run, with no record of the edit — the same class of problem as a fixture edited to make tests pass.
2. **Redaction does not revoke.** The credential is still live at the moment it is written. A silent redact would make the leak *invisible* while leaving the token valid — strictly worse than a loud failure, because nobody is prompted to revoke.
3. **Loud failure is what actually teaches the rule.** The block is where the author learns the redact-and-revoke discipline (Decision 5); a silent rewrite teaches nothing.
4. **Every sibling gate in this repo blocks rather than fixes.** `check:openspec`, `check:schemas`, `check:repo-integrity`, `check:scala-quality`, and the existing `check:no-credential-leak` all report and exit non-zero. A single auto-mutating gate would be an unpleasant surprise in a chain that is otherwise read-only.

Reversibility: high. This is a behavioral choice inside one script; nothing downstream depends on it. **Decided locally rather than escalated, on the owner-away instruction, as reversible, low-stakes and defensible.**

## Decision 2 — False positives are resolved by a convention, never by allowlist entries

**Chosen: extend HEL-956's existing synthetic-marker convention, and choose per-surface rules that are structurally clean against the already-committed tree. No new per-value allowlist. No new evidence file will ever need to add an entry to the gate.**

The measurement that drove this (run against the real tree before any code was written):

| Candidate rule | Hits on the three surfaces being added — `openspec/` + `docs/` + `notes/` (5,882 tracked files) |
| --- | --- |
| Existing `VENDOR_PREFIX_SECRET_REGEX` (`helio_pat_`/`sk-ant-` + ≥20 token chars) | 3, **all** exempt via the existing `should-never` marker |
| Existing `NAMED_SECRET_LITERAL_REGEX` (identifier ending KEY/SECRET/TOKEN/PASSWORD + ≥8 chars) | **~15 false positives** |
| New high-entropy variant (same identifiers + ≥32 chars of `[A-Za-z0-9+/=_-]`) | **0** |

The ~15 false positives are real committed content that must not be rewritten: `bindingKey = "outputId"`, `key = "dashboard"`, `password: "correct horse battery staple 1!"`, `apiKey = "YOUR_NVD_API_KEY"`, `idempotencyKey: "skeptic-live-key-1"`, `token = "sekret-token"`, and several fixture values quoted inside archived skeptic reports. **`openspec/changes/archive/**` is immutable history.** A design that requires editing it, or that requires ~15 allowlist entries, is the wrong design — and an allowlist-per-value design would also mean every future evidence file might need a gate edit, which the ticket explicitly rules out.

So the rule set for the new surfaces is:

1. **Vendor-prefix rule — reused unchanged.** `(helio_pat_|sk-ant-)[A-Za-z0-9_-]{20,}`. Already measured by HEL-956 against ground truth (`ApiTokenService.scala` documents the real PAT as `helio_pat_` + 64 hex): a real credential always matches; `helio_pat_` alone, `helio_pat_test`, `helio_pat_xxxxxxxx`, `helio_pat_…` and `helio_pat_<valid-token>` all structurally do not.
2. **High-entropy named-literal rule — new.** Identifier ending `KEY`/`SECRET`/`TOKEN`/`PASSWORD`, assigned a run of ≥32 characters from `[A-Za-z0-9+/=_-]`. This is the ticket's "base64 blobs assigned to `*_KEY`/`*_SECRET`/`*_TOKEN`" clause. A 32-byte base64 key is 44 characters and a 64-hex token is 64; every measured legitimate value is shorter, or contains spaces/punctuation outside the class, and is therefore excluded *structurally* rather than by exemption.

The convention a future author follows, stated in the gate's failure message and in `CONTRIBUTING.md`: **make a fake secret look fake.** Carry one of the documented markers (`not-a-real`, `should-never`, `should-not`, `dummy`, `placeholder`, `fake`, `example`, `redacted`, `replace-with`, `synthetic`, `xxxx`), or use all zeros, or the empty string. Marker matching normalizes `_` to `-` first, so `re_test_key_should_never_be_logged` is recognized identically to its hyphenated form — measured to matter. Precisely: on the surfaces this change actually scans, normalization is what removes exactly one live false positive — `CONNECTOR_MASTER_KEY=REPLACE_WITH_OUTPUT_OF_openssl_rand_dash_base64_32` in `docs/cloud-dev-setup.md`. The other motivating value, `re_test_key_should_never_be_logged`, lives in `backend/src/test/scala/**`, a tree Decision 3 leaves unscanned — it is not a live false positive today, and is cited only as one of the nine code-tree values that a future widening would have to handle.

Widening the marker set can only make the gate more permissive for *fake-looking* values; it cannot cause a real credential to be missed, because a real credential does not contain the word "dummy".

Reversibility: high. **Decided locally, per the owner-away instruction.**

## Decision 2a — This change's own evidence file must not trip the gate it adds (skeptic-design-1 CR1)

Making `openspec/**` a scanned surface creates an immediate self-reference: task 5's mutation transcripts are written to `openspec/changes/credential-shaped-string-commit-guard/mutation-evidence.md`, and the planted values must carry **no** synthetic marker (a marker would exempt them and prove nothing). Written naively, the evidence file matches the new rule and turns the gate permanently red — in merge-blocking CI. The two resolutions an executor would reach for unprompted are both wrong: weakening the plant until it no longer matches destroys the proof, and adding an allowlist entry breaks Decision 2's explicit promise.

**Chosen resolution — separate the plant from the transcript:**

1. **The unelided planted value exists only in an untracked, `.gitignore`d scratch file**, named with the established `.hel846-` prefix, created under the surface being exercised and deleted immediately after. The gate walks the filesystem rather than the git index, so a gitignored plant is still genuinely scanned — the detection is real, and the value is never committed.
2. **The committed transcript pastes the gate's own output, which is safe by construction.** Verified against the shipped code: `checkSecretLiterals` (and therefore `checkDeliverySecrets`, which follows it) reports `file:line` and the convention hint only — it never echoes the matched value. So the red transcript can be pasted verbatim.
3. **Where the evidence must describe the planted value itself, it is elided or carries a marker** — e.g. "planted `helio_pat_` followed by 64 hex-shaped characters (elided)". The shape is what the reader needs; the literal is not.

**The standing consequence, stated plainly because it is permanent and repo-wide.** From this change onward, **every file under `openspec/`, `docs/` and `notes/` — including every future evidence file, review report and archived transcript — that quotes a credential-shaped value must either carry a documented synthetic marker or elide the value.** Decision 2's promise that "no new evidence file will ever need an allowlist entry" is true *because* authors follow that convention, not instead of it. This is exactly the redact-before-committing discipline the ticket exists to establish, now mechanically enforced on the trees where delivery evidence lives — so the constraint and the goal are the same thing, not a side effect. It is written into `CONTRIBUTING.md` alongside the redact-and-revoke rule (Decision 5), and into the gate's own failure message, so an author who trips it is told the convention at the point of failure rather than having to find this document.

## Decision 3 — Extend the existing gate; do not build a sibling script

The script's header says HEL-846's guard is "not this one". Read literally that suggests a sibling; read in context it is describing the *scope of the `mcp` surface's `secretLiteral` check*, in the same file that then says "Any future surface MUST go through `SURFACES` alone".

**Chosen: extend `SURFACES` with three new surfaces.** A sibling script would have to re-derive, from scratch, every one of the seven defect closures HEL-956 and HEL-993 paid for — vacuity failure, table validation, positional file-list pairing, unreadable-file failure, unlistable-directory failure, BFS read failure, fail-closed entry guard — and the overwhelmingly likely outcome is that it re-introduces some of them. Extension inherits all seven for free and makes the coverage-drift guard *more* meaningful (three directories move from acknowledged-unscanned to covered).

New surfaces: `delivery-evidence` (`openspec/`), `docs` (`docs/`), `notes` (`notes/`), all `include: "allNonBinary"`, all `checks: ["deliverySecret"]`.

**Scope boundary, stated honestly.** `scripts/`, `schemas/`, `e2e/`, `infra/`, `backend/src/test/scala/**` and the rest of `frontend/`/`backend/` stay unscanned/partial. Rationale: the three chosen trees are where delivery agents write evidence prose; the excluded trees are code, where the named-literal shape is common and where the measurement above found nine legitimate `should-not`/`should_never`-style test values that would need marker work first. Their `ACKNOWLEDGED_UNSCANNED`/`PARTIAL_COVERAGE` reasons must be **updated to stop naming HEL-846 as the future backstop** — that claim becomes false the moment this ships, and leaving it would be exactly the "confidently false documentation" trap this repo has been bitten by. Widening to code trees is a legitimate follow-up, not this ticket.

## Decision 4 — `deliverySecret` is a new check name, and `secretLiteral` is left alone

`KNOWN_CHECKS` gains `deliverySecret`. The `mcp` surface's `checks` array is **not** modified, so the hardened existing surface's behavior changes only through the shared marker-normalization widening (Decision 2), which is strictly more permissive and is covered by the existing self-test cases plus a new one.

`deliverySecret` dispatches to a new `checkDeliverySecrets(file, text, errors)` that applies rules 1 and 2 from Decision 2. It reuses `VENDOR_PREFIX_SECRET_REGEX` and `isSyntheticSecretLiteral`; it does **not** reuse `NAMED_SECRET_LITERAL_REGEX`.

## Decision 5 — The redact-and-revoke rule goes in `CONTRIBUTING.md`

**Where it went and why.** `CONTRIBUTING.md`. It is tracked, durable, already named in `CLAUDE.md` as the binding code-quality standard that delivery agents are bound to read at the point of use, and it is **not** a render target.

`.concertino/laws/` and `scripts/concertino/` were rejected outright: this repo's own `CLAUDE.md` states that every file under `scripts/concertino/` is rendered by `concertino sync` from the upstream Concertino repo and that "a local edit to a rendered script is silently erased by the next `concertino sync`". Writing a durability-critical rule into a directory whose contents are regenerated from another repository would be a rule with a scheduled deletion date. A one-line pointer from a Concertino-side role doc is a legitimate follow-up in *that* repo; it is out of scope here and cannot be done from this worktree.

The rule text states both obligations — redact before committing, revoke when the run ends — plus the gate that enforces the first and the marker convention for fixture values.

## Decision 6 — CI is the enforcement point that cannot be skipped

The acceptance criterion is unmet today for the *existing* checks: `check:no-credential-leak` and `check:no-credential-leak:selftest` are in `.husky/pre-commit` and **not** in `.github/workflows/ci.yml`. The hook chain is bypassable with `git commit -n` (`.github/workflows/ci.yml` records that this has actually happened once, in HEL-913), and `npm test` inside the hook is vacuous in the linked worktrees where every delivery runs (HEL-768/HEL-880).

**Chosen: add both to the `frontend` job of `.github/workflows/ci.yml`, and keep the husky steps.** CI is merge-blocking via the `ci-complete` required check. This follows the verbatim precedent comment already in that file from HEL-913 task 11b, which chose CI over husky for exactly this reason and noted that touching `.husky/**` would trip the gate-chain requirements "for strictly weaker enforcement".

Both the gate and its self-test are wired, so a gate silently degraded into scanning nothing is caught by the same merge-blocking run.

`.husky/pre-commit` itself is **not** edited (it already invokes both scripts). Root `jest.config` and jest structure are **not** touched — HEL-768 is in flight against them and the ticket makes restructuring them an escalation, not a local call. Adding no new `package.json` script is required either, since both npm scripts already exist.

## Decision 7 — Self-test cases, and the mutation bar

Every new surface and the new check gets a case in `scripts/check-no-credential-in-agent-surface.selftest.mjs`, in the file's established shape: plant a `.hel846-`-prefixed, `.gitignore`d file through the real subprocess harness, assert non-zero exit, remove it, assert zero exit, with `finally`-guarded **and** idempotent-at-startup cleanup so a crashed run cannot leave the tree red for an unrelated reason.

**"Silence reads as green" paths are defects, by this repo's standard.** For each new case the executor must show the mutation red, not argue it:

- Each new surface is genuinely scanned — remove that surface's entry from `SURFACES` and the planted credential must stop being detected (and, since the drift guard then reclassifies the directory, the gate must fail for the *drift* reason instead — both observations recorded).
- The check is genuinely dispatched — remove `deliverySecret` from a surface's `checks` and the planted value must go undetected.
- The vacuity guard covers the new surfaces — the three new roots all exist and are non-empty; a rename must produce the vacuous-surface failure.
- The new high-entropy rule is live — a planted 44-character base64 blob assigned to `API_KEY` must fail; the same value carrying a synthetic marker must pass.
- The marker normalization is live — an underscore-separated marker must pass; removing the normalization must turn a case red.

Rejected: asserting on the OK line's file counts as a *substitute* for a plant-and-detect case. A count is not detection. Counts are asserted *in addition*.

## Risks

- **False positive on a future evidence file.** Mitigated by the entropy gate and the marker convention; measured zero against the 5,882 tracked files of the three surfaces being added (and zero on the wider nine-tree probe of 7,610 files described in the Gate-Chain checklist). If one occurs, the author follows the convention rather than editing the gate.
- **Scan cost.** Three more `allNonBinary` trees, roughly 3–4k files of markdown, read once with two regexes. The existing gate already reads `helio-mcp/**` this way. Expected well under a second; the executor measures it and records the number.
- **False negative by construction.** The high-entropy rule does not catch a low-entropy real password, and neither rule catches a credential written with no identifier and no known vendor prefix. Stated as a known residual limit in the script header, in the same honest-limits style HEL-956/993 established — not silently omitted.

## Gate-Chain Implications Checklist

**What does it execute?** `scripts/check-no-credential-in-agent-surface.mjs` — a single Node ESM script, run as `node scripts/check-no-credential-in-agent-surface.mjs` by the `check:no-credential-leak` npm script, which `.husky/pre-commit` invokes and which this change additionally wires into `.github/workflows/ci.yml`. It spawns no subprocess, invokes no git, makes no network call, and imports only `node:fs`, `node:path` and `node:url`. Its self-test (`...selftest.mjs`) does spawn subprocesses — `node` against the gate script itself, via `spawnSync` — and nothing else. This change adds no new executable, no new binary dependency, and no new npm script.

**What environment does it inherit, and from where?** Whatever the invoking shell provides. It reads **no** environment variable — no `NODE_ENV`, no `GIT_DIR`, no `PATH`-dependent lookup beyond `node` itself being resolved by npm. All paths are derived from `import.meta.url` relative to the script's own location, so it is insensitive to the caller's working directory and to a linked worktree's `.git` file indirection (the HEL-657/HEL-805 poisoned-`GIT_DIR` class does not apply, since it never touches git). In CI it inherits the `ubuntu-latest` runner environment after `npm ci`; in the hook it inherits the committing shell's.

**Does it write anything outside its own sandbox?** The gate script writes **nothing** — it is read-only over the filesystem and its only outputs are stdout/stderr and an exit code. The self-test writes, and then removes, a fixed set of `.hel846-`/`.hel956-`/`.hel993-`/`.hel927-`-prefixed files under the repository, each `.gitignore`d, each removed in a `finally` and again idempotently at startup; this change adds `.hel846-` paths to that same set and to `.gitignore`. Neither writes outside the repository, to a temp directory, to a global config, or to the git object store.

**Does it behave differently from a linked worktree than from a main checkout?** It must not, and the drift guard is the reason to be careful: a linked worktree's top-level contents differ from the main checkout's by uncommitted build/tooling output, which is exactly why `IGNORED_TOP_LEVEL` and the dot-directory skip exist, and why `classifyTopLevelDirs` was exported as a pure function so it can be evaluated against the main checkout's listing without running that checkout's copy. The three new surface roots (`openspec/`, `docs/`, `notes/`) are all tracked directories present in every checkout, so they are non-vacuous in both. The executor must run the gate from **both** the worktree and the main checkout and record both transcripts. One real asymmetry is inherited and unchanged: the husky-invoked `npm test` is vacuous in a worktree (HEL-768/HEL-880), which is precisely why Decision 6 puts enforcement in CI.

**What happens on its first run?** It is run standalone against the pre-existing tree before anything is wired, to confirm zero false positives — the same "first run" discipline the script's header records for its own earlier surfaces. Planning already ran the rule set as a standalone probe over 7,610 files across `openspec/`, `docs/`, `notes/`, `schemas/`, `e2e/`, `scripts/`, `frontend/src/`, `backend/src/`, `helio-mcp/`: zero hits on the three surfaces being added. The first *wired* run therefore prints an OK line with three additional named surfaces and a larger total, and requires no repository content to be changed to pass. There is no first-run migration, no cache to warm, no state to initialize.
