## Why

Delivery agents legitimately mint real credentials to drive live end-to-end verification — that realism is why those runs catch defects green test suites miss. Nothing today mechanically prevents such a credential from being written into an evidence transcript and committed.

**This is preventive hardening, not incident response.** A history scan against `main` confirms no real-shaped credential has ever landed in `openspec/changes/**`: a sweep of `helio_pat_[A-Za-z0-9]{20,}` across every commit that ever touched that tree returns zero hits, and every `helio_pat_`/`sk-ant-` occurrence at HEAD is prose, a bare-prefix mention, a spec placeholder, or a deliberately synthetic fixture carrying a `should-never` marker. HEL-828's transcript was redacted before it was committed. No claim to the contrary appears anywhere in this change.

The gap is coverage, and it is precisely locatable in the existing gate's own text. `scripts/check-no-credential-in-agent-surface.mjs` declares three surfaces (`assistant-surface`, `fixture`, `mcp`), and its `ACKNOWLEDGED_UNSCANNED` table classifies `openspec`, `docs` and `notes` as deliberately unscanned. Its header states verbatim that generic token-shaped secrets "ANYWHERE agents write files during delivery are HEL-846's guard, not this one", and two of its `ACKNOWLEDGED_UNSCANNED`/`PARTIAL_COVERAGE` reasons name "HEL-846 is the intended generic backstop". This change is that backstop.

A second, independent gap was measured while planning: **`check:no-credential-leak` is wired into `.husky/pre-commit` only, and not into `.github/workflows/ci.yml`.** It is therefore bypassable today with `git commit -n`, and the acceptance criterion "runs somewhere it cannot be silently skipped" is unmet for the *existing* checks, not just the new one.

## What Changes

- **Widen the gate's declared coverage to the trees delivery agents actually write.** Add three surfaces to the existing `SURFACES` table — `openspec/`, `docs/`, `notes/` — and remove their now-obsolete `ACKNOWLEDGED_UNSCANNED` entries so the coverage-drift guard reclassifies them as covered. No new scanning mechanism is introduced: coverage flows through the single existing `collectFiles` + `runChecksForSurface` loop, inheriting every structural guard HEL-956 and HEL-993 added.
- **Add one new check, `deliverySecret`,** applied to those three surfaces only. Two rules: (1) the existing entropy-gated vendor-prefix rule (`helio_pat_`/`sk-ant-` followed by ≥20 token characters), reused unchanged; (2) a new high-entropy named-literal rule — an identifier ending `KEY`/`SECRET`/`TOKEN`/`PASSWORD` assigned a ≥32-character run of base64/hex-alphabet characters. This is the ticket's "base64 blobs assigned to `*_KEY`/`*_SECRET`/`*_TOKEN`" clause.
- **Do NOT apply the existing `namedSecretLiteral` rule to these surfaces.** Measured: it produces roughly 15 false positives against the committed `openspec/` tree (`bindingKey = "outputId"`, `key = "dashboard"`, `password: "correct horse battery staple 1!"`, `apiKey = "YOUR_NVD_API_KEY"`, and prose-quoted fixture values in archived skeptic reports). Archived evidence is immutable history; a rule that requires rewriting it is the wrong rule. The high-entropy variant scores **zero** hits on that same tree.
- **Extend the synthetic-marker convention rather than any allowlist.** Normalize `_` to `-` before marker matching and add `should-not`, `replace-with`, `synthetic` and `xxxx` to the marker set. This is a convention a future author follows by making a fake secret look fake — never by editing the gate.
- **Wire `check:no-credential-leak` and `check:no-credential-leak:selftest` into `.github/workflows/ci.yml`,** following the verbatim HEL-913 precedent already recorded in that file. The husky hook stays; CI is merge-blocking and cannot be bypassed.
- **Extend the self-test** with mutation-verified cases for each new surface and for the new check, in the established plant → assert red → remove → assert green shape, with `finally`-guarded and idempotent cleanup.
- **Write the redact-and-revoke rule into `CONTRIBUTING.md`,** a durable, tracked, agent-read location. Deliberately NOT `.concertino/` or `scripts/concertino/`, which are render targets erased by the next `concertino sync`.

Not breaking. No API, schema, or database change; no Flyway migration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-surface-credential-gate`: the declared-surface set now includes the delivery-evidence trees; a new credential-shape check applies to them; the false-positive convention is stated as marker-based with separator normalization; and the gate's enforcement point is specified as merge-blocking CI in addition to the pre-commit hook.

## Impact

- `scripts/check-no-credential-in-agent-surface.mjs` — new surfaces, new `deliverySecret` check, `KNOWN_CHECKS` entry, widened synthetic markers, updated coverage tables and header documentation.
- `scripts/check-no-credential-in-agent-surface.selftest.mjs` — new mutation-verified cases.
- `.github/workflows/ci.yml` — two new merge-blocking steps in the `frontend` job.
- `CONTRIBUTING.md` — the redact-and-revoke rule.
- `.gitignore` — ignore entries for `.hel846-`-prefixed self-test artifacts.
- **Gate chain:** `scripts/check-no-credential-in-agent-surface.mjs` is invoked by `.husky/pre-commit`, so CON-132 applies with full force — `design.md` carries the verbatim Gate-Chain Implications Checklist and delivery requires per-script isolation-test transcripts.
- **Deliberately untouched:** root `jest.config`/jest structure (HEL-768 is in flight against it), `.husky/pre-commit` itself, `backend/**`, `frontend/**`, any Flyway migration, and every archived `openspec/changes/archive/**` file (the design is constrained so none needs rewriting).
