## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Spawned cold. Every conclusion below is from a command I ran myself in this
worktree at `9a563bbb`; the executor/evaluator reports were read only as
claims. **No browser / Playwright / e2e** — deliberately skipped per the
orchestrator's constraint and because this change has zero UI surface
(diff touches only `scripts/*.mjs`, `.github/workflows/ci.yml`,
`.gitignore`, `CONTRIBUTING.md` and change artifacts). There is genuinely
nothing to render; `DESIGN.md` does not apply.

### What I verified (with evidence)

**Baseline / mechanical gates (re-run, not read)**
- `node scripts/check-no-credential-in-agent-surface.mjs` →
  `OK (5990 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 5885 delivery-evidence, 15 docs, 8 notes, 0 violations)`, exit 0, **0.52s** wall clock.
- `node scripts/check-no-credential-in-agent-surface.selftest.mjs` → `OK`, exit 0, all HEL-846 cases green.
- `npx prettier --check` on all four modified non-artifact files → clean.
- `npm run check:openspec` → `openspec/ is clean`.

**AC1 — red-then-green, independently reproduced (not narrated)**
Planted `helio_pat_` + 64 hex-shaped chars (elided) into gitignored
`.hel846-plant.md` scratch files at each of the three new surface roots:
gate went **exit 1** with three violations naming
`openspec/.hel846-plant.md:1`, `docs/.hel846-plant.md:1`,
`notes/.hel846-plant.md:1`; removing them returned exit 0 with the identical
5990-file OK line. Repeated for the high-entropy rule (44-char base64-shaped
blob assigned to `API_KEY`) → exit 1 naming `identifier "API_KEY"`.
**The failure text never echoed the matched value** — I grepped the stderr
for the planted literal; absent in both rules. This is what makes the
committed transcripts safe.

**Marker convention (Decision 2 / owner decision #2)**
`dummy`-marked and `should_never`-marked (underscore) variants of the same
planted values both pass with **no gate edit**. Removing the `_`→`-`
normalization from the shipped script turns the underscore case red;
restored.

**"Silence reads as green" hunt (the specific brief)** — all reproduced by me:
- `deliverySecret` **is** in `KNOWN_CHECKS`, **is** dispatched in
  `runChecksForSurface`, and **is** in the `needsText` disjunction
  (`scripts/check-no-credential-in-agent-surface.mjs:739`, `:753`). I deleted
  the `needsText` clause and, separately, the dispatch line, with a plant in
  place: both produced a silent `OK`/exit 0 — i.e. the HEL-956 CR1 defect
  class is live here, and the self-test is what closes it (see below).
- Deleting the `delivery-evidence` `SURFACES` entry → `COVERAGE DRIFT:
  top-level directory "openspec" is not classified`. Pointing `notesRoot` at
  a nonexistent path → both `COVERAGE DRIFT` and `VACUOUS SURFACE: "notes"`.
  So the three new surfaces genuinely participate in **both** structural guards.
- **Can a new regex silently match nothing?** I widened
  `HIGH_ENTROPY_NAMED_SECRET_REGEX`'s bound from `{32,}` to `{200,}` (the
  "matches nothing" mutation) → **selftest FAIL (3 failures)**. Guarded.
- **Can a self-test case pass while testing nothing?** No. `runMutatedScript`
  (`selftest.mjs:255-266`) asserts **exactly one** occurrence of the search
  string in the *shipped* file and throws otherwise; the mutated copies are
  `.hel846-`-prefixed, gitignored, under `scripts/` (an
  `ACKNOWLEDGED_UNSCANNED` tree, so no self-detection). I confirmed this is a
  real guard, not decoration: mutating the shipped script's `needsText`
  clause, and separately deleting the shipped `notes` surface entry, each made
  the selftest **throw and exit 1** rather than pass. Gutting
  `checkDeliverySecrets`' body → **selftest FAIL (9 failures)**. The
  status-0-asserting cases are self-guarding too: a no-op mutation leaves the
  plant detectable and flips them red.
- Plants are written via `writeHel846Plant` with `mkdirSync(recursive)`, are
  `finally`-guarded **and** idempotently removed at startup. I verified after a
  deliberately crashed run (the thrown-mutation case above) that **zero** stray
  plants or mutated copies remained and `git status --porcelain` was clean.

**AC2 — zero false positives on the real tree**
The 5990-file green run covers every named case. Spot-confirmed the specific
ones: `helio_pat_xxxxxxxx` in `helio-mcp/src/config.ts:28` and
`helio-mcp/README.md:38`; `helio_pat_<valid-token>` spec placeholders in the
2026-07-12 archive; `helio_pat_<redacted>` elided forms in the 2026-08-27
archive; `sk-ant-SECRET-SHOULD-NEVER-LEAK-xyz` in the archived HEL-401
reports. All inside the scanned 5885 `delivery-evidence` files, all green.
Main-checkout run: `origin/main`'s script in the main checkout is OK (82
files). The worktree tree is a strict superset of main's `openspec`/`docs`/
`notes` content, so green-on-superset covers it; I did not write into the
main checkout.

**AC3 — durable location.** The redact-and-revoke rule is in
`CONTRIBUTING.md` (new "Credential handling in delivery evidence (HEL-846)"
section), which is tracked, is named in `CLAUDE.md` as a canonical standard,
and is **not** a render target. The section itself states why `.concertino/`
and `scripts/concertino/` were rejected. Revoke-half and short-lived-credential
preference are both present.

**AC4 — cannot be silently skipped.** `python3 -c yaml.safe_load` on
`.github/workflows/ci.yml` parses, and the `frontend` job's step list really
contains `npm run check:no-credential-leak` and
`npm run check:no-credential-leak:selftest`, placed after the other `check:*`
steps and before `npm test`. `.husky/pre-commit` is untouched.

**Constraints.** `git diff origin/main..HEAD --name-only` shows no Flyway
migration; `.husky/**`, root `jest.config*` and `package.json` are all
**unmodified** (empty diff — HEL-768 uncontested); no new npm script (both
already existed). Extension census over `openspec`/`docs`/`notes`: only
`md/yaml/txt/tsv/py/png/mjs/jpg/html/gif/awk` — `.png`/`.jpg`/`.gif` are
already in `BINARY_FIXTURE_EXTENSIONS`, no `.webp`/`.ico`/`.mp4`, so task
4.6's "leave it unchanged" is correct as measured. No real credential
anywhere in the diff (planted values are `helio_pat_` + repeated
`a1b2c3d4e5f6`, and `"a".repeat(44)`). Grepped every artifact for
leak-implying language: the only hits are explicit **negations** ("no
artifact states or implies…", "preventive hardening, not incident response").

**Gate chain (CON-132).** Both required isolation transcripts exist under
`.concertino/gate-chain-isolation-evidence/` and record `PASS`.

**Owner decision #2 judged as shipped code, not prose.** The exemption path
is a convention (`isSyntheticSecretLiteral` markers + elision), not an
allowlist; there is no per-file or per-path exception table anywhere in the
new code. A realistic future evidence file — a skeptic report pasting this
gate's own FAIL output, a docs page showing `CONNECTOR_MASTER_KEY=<44-char
base64>` — is satisfiable by adding a marker or eliding, with **no gate edit**.
I could not construct a realistic case that forces one.

### Verdict: REFUTE

One finding. Everything load-bearing above holds; this is a factual error in
a committed delivery artifact, in exactly the class the previous two rounds
each caught (a change-directory-scoped path that goes stale on archive).

### Change Requests

1. `openspec/changes/credential-shaped-string-commit-guard/files-modified.md:7`
   is **stale and factually wrong about the shipped diff**. It states the
   `.gitignore` entries were added for "`.hel846-plant.md` under
   `openspec/changes/credential-shaped-string-commit-guard/`, `docs/`,
   `notes/`". The shipped `.gitignore:80-82` is
   `/openspec/.hel846-plant.md`, `/docs/.hel846-plant.md`,
   `/notes/.hel846-plant.md` — the change-directory path was **removed** by
   commit `9a563bbb` ("Fix self-test plant path staleness across change
   archival"), which was the previous round's own fix. `mutation-evidence.md`
   (lines 307-322) and `selftest.mjs` (lines 87-98) were both updated to the
   corrected root-level paths; `files-modified.md` was not. Correct the bullet
   to name `openspec/.hel846-plant.md` (root, not the change directory) so the
   archived record of this change does not document the very path the fix
   eliminated — a future author copying that bullet reintroduces the
   archive-staleness crash on a now-merge-blocking CI step. One-line edit; no
   re-verification needed beyond re-running the gate and selftest (both ~1s).

### Non-blocking notes

- Adding `xxxx` to `SYNTHETIC_SECRET_MARKERS` is a genuine (small) widening of
  the exemption: any credential-shaped value containing the substring `xxxx`
  is now exempt on all five surfaces that use `isSyntheticSecretLiteral`,
  including `mcp`'s pre-existing `secretLiteral` check. Justified by
  `helio_pat_xxxxxxxx` and vanishingly unlikely to collide with a real token,
  but it is a shared-helper change, not a delivery-surface-scoped one.
- The residual-limits header entry is honest and concrete (a `helio_session`
  cookie in a pasted `curl` transcript is not caught). Worth a tracked
  follow-up ticket rather than leaving it as a comment only.
- `evaluation-2.md` is currently untracked in the worktree; it needs
  committing before delivery or it is lost with the worktree.
