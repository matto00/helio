# Tasks — HEL-846

Read `design.md` first. The evidence bar is set by HEL-956 and HEL-993: **seven defects in this same gate, none found by reading the source, all by mutation.** Every "this would go red" claim below must be an actually-executed command with its transcript pasted into the evidence file. Reasoning about a mutation is not evidence.

Do **not** use Playwright and do **not** run e2e specs — this is build tooling with no UI surface. Do **not** add a Flyway migration. Do **not** restructure jest config or `.husky/pre-commit`.

## 1. Baseline

- [x] 1.1 Run `npm run check:no-credential-leak` and `npm run check:no-credential-leak:selftest` unmodified, from the worktree. Record both transcripts as the pre-change baseline (expected: OK with 3 surfaces; selftest green).
- [x] 1.2 Record the pre-change per-surface counts from the OK line so the post-change counts are comparable.

## 2. Widen the synthetic-marker convention (design Decision 2)

- [x] 2.1 In `isSyntheticSecretLiteral`, normalize the value by replacing `_` with `-` before marker matching.
- [x] 2.2 Add `should-not`, `replace-with`, `synthetic`, `xxxx` to `SYNTHETIC_SECRET_MARKERS`.
- [x] 2.3 Update the marker-convention comment block to list the full set and state that normalization happens first.
- [x] 2.4 Confirm this is strictly more permissive: re-run 1.1's gate and selftest; both must stay green with unchanged counts.

## 3. Add the `deliverySecret` check (design Decision 4)

- [x] 3.1 Add `HIGH_ENTROPY_NAMED_SECRET_REGEX` — identifier ending `key`/`secret`/`token`/`password` (case-insensitive), `[:=]`, optional quote, then `[A-Za-z0-9+/=_-]{32,}`. Comment in the shipped regex **why the quote is optional here** when `NAMED_SECRET_LITERAL_REGEX` requires it: these surfaces are markdown transcripts, where a leaked value appears as `TOKEN=abc...` in pasted shell output far more often than as a quoted source literal. Document the bound against ground truth (32-byte base64 = 44 chars; `helio_pat_` + 64 hex = 74) and the measured legitimate values it structurally excludes.
- [x] 3.2 Add `checkDeliverySecrets(file, text, errors)` applying `VENDOR_PREFIX_SECRET_REGEX` and the new regex, both exempted only via `isSyntheticSecretLiteral`. Failure messages name file and line, state the marker convention, and — for the delivery-evidence surfaces — say that eliding the value is equally acceptable. **The message must not echo the matched value** (this is what makes Decision 2a's transcripts safe to commit); confirm this explicitly.
- [x] 3.3 Add `"deliverySecret"` to `KNOWN_CHECKS` and dispatch it in `runChecksForSurface`, including it in the `needsText` disjunction. **Verify `needsText` explicitly** — omitting it there is exactly the silent-no-op class HEL-956 CR1 found.
- [x] 3.4 Do **not** modify `NAMED_SECRET_LITERAL_REGEX`, `checkSecretLiterals`, or the `mcp` surface's `checks` array.

## 4. Add the three delivery-evidence surfaces (design Decision 3)

- [x] 4.1 Add `delivery-evidence` (`openspec/`), `docs` (`docs/`), `notes` (`notes/`) to `SURFACES`, each `include: "allNonBinary"`, `checks: ["deliverySecret"]`.
- [x] 4.2 Remove `openspec`, `docs`, `notes` from `ACKNOWLEDGED_UNSCANNED` so the drift guard classifies them as covered. Confirm `classifyTopLevelDirs` yields no `unclassified` entry.
- [x] 4.3 Update the `scripts` `ACKNOWLEDGED_UNSCANNED` reason and the `backend` `PARTIAL_COVERAGE` reason to stop naming HEL-846 as a future backstop — that claim becomes false on merge. State the real, current reason instead (code trees, named-literal shape common, out of this ticket's scope).
- [x] 4.4 Update the script header: the surface table listing, the HEL-846 paragraph (it is now implemented here, not elsewhere), and a new honest "residual limits" entry for `deliverySecret` (no low-entropy real password; no credential with neither a known vendor prefix nor a credential-named identifier). Name a **concrete** instance of that second limit rather than describing it abstractly: a `helio_session` cookie value pasted inside a `curl` transcript has no vendor prefix and no credential-named identifier, and is not caught.
- [x] 4.5 Update the FAIL summary paragraph in `main()` to describe the new surfaces/check alongside the existing ones.
- [x] 4.6 Check `BINARY_FIXTURE_EXTENSIONS` against the three new trees. `.webp`/`.ico`/`.mp4` are absent from it today; confirm whether any exist under `openspec/`, `docs/` or `notes/` (measured at planning time: none). If none, leave the set unchanged and say so — do not widen it speculatively. If any exist, add them, since a utf8 read of one produces false-positive garbage.

## 5. Prove it, by mutation (design Decision 7) — the load-bearing task

**Read design.md Decision 2a before starting this section — the naive version of it does not work.** This change makes `openspec/**` a scanned surface, so an unmarked planted value written into a committed evidence file under `openspec/` turns the new gate permanently red in merge-blocking CI. Do **not** resolve that by weakening the plant (it destroys the proof) or by adding an allowlist entry (it breaks Decision 2). Follow Decision 2a:

- Plant the unelided value **only** into an untracked, `.gitignore`d `.hel846-`-prefixed scratch file under the surface being exercised, and delete it immediately after. The gate walks the filesystem, not the git index, so the detection is genuine.
- Paste the gate's own stderr verbatim into the committed evidence — it reports `file:line` and the convention hint only, and never echoes the matched value (verified in `checkSecretLiterals`).
- Where the evidence must describe the planted value, **elide it or give it a marker** — "planted `helio_pat_` + 64 hex-shaped chars (elided)". Never write the unelided literal into a tracked file.
- After finishing this section, run the gate once more with all plants removed and confirm the committed `mutation-evidence.md` itself passes. If it does not, the evidence file — not the gate — is what to fix.

Write every transcript into `openspec/changes/credential-shaped-string-commit-guard/mutation-evidence.md`. Planted values must be obviously synthetic and carry no synthetic marker (a marker would exempt them) — e.g. a `helio_pat_` followed by 64 characters of a repeated non-marker hex-shaped string, and a 44-character base64-shaped blob assigned to `API_KEY`. **Never a real credential.**

- [x] 5.1 **AC1 red-then-green, vendor rule.** Plant a credential-shaped `helio_pat_` value in a file under `openspec/`; run the gate; paste the non-zero exit and the naming line. Remove it; run again; paste the zero exit. Repeat for `docs/` and `notes/`.
- [x] 5.2 **AC1 red-then-green, high-entropy rule.** Same shape with a 44-char base64 blob assigned to `API_KEY`.
- [x] 5.3 **Marker convention holds.** The same planted value carrying `dummy` passes, with no gate edit. Also plant an underscore-separated marker (`should_never`) and show it passes — then temporarily remove the `_`→`-` normalization and show that case goes red. Restore.
- [x] 5.4 **Each surface is genuinely scanned.** For each of the three new surfaces: with the plant in place, delete that surface's `SURFACES` entry and show the credential is no longer detected as a credential (the run will now fail for a coverage-drift reason instead — record both observations). Restore.
- [x] 5.5 **The check is genuinely dispatched.** With a plant in place, remove `"deliverySecret"` from that surface's `checks` and show the value goes undetected. Restore. Then separately remove `deliverySecret` from the `needsText` disjunction and show the same silent pass. Restore.
- [x] 5.6 **Vacuity guard covers the new surfaces.** Exercise this on **`notes/`** — or, preferably, via the existing mutated-copy harness convention (`scripts/.hel956-selftest-mutated-surfaces.mjs` / `scripts/.hel993-selftest-mutated-entry.mjs`, already `.gitignore`d) by pointing a surface root at a nonexistent path rather than moving a tracked tree. Show the vacuous-surface failure naming the surface and its root, then restore. **Never rename `openspec/`** — it holds this change's own directory (the artifacts under review and the evidence file) plus `openspec/specs/**`, on which `check:openspec` and the delivery `assert-phase.sh` chain depend; an interrupted run mid-rename leaves the worktree with no change directory at its expected path.
- [x] 5.7 **`assertSurfacesValid` still holds.** Show that a duplicate id or an unknown check name among the new entries throws before any scan, using the existing mutated-copy harness convention.

## 6. AC2 — zero false positives on the real tree

- [x] 6.1 With no plants present, run the gate from the worktree. Paste the OK line showing six named surfaces, the new total, and 0 violations.
- [x] 6.2 Run it from the **main checkout** too (read-only; do not modify that checkout) and paste that transcript — design Decision 7 / gate-chain "linked worktree vs main checkout".
- [x] 6.3 Explicitly confirm the named legitimate cases pass: `helio_pat_xxxxxxxx` in `helio-mcp/src/config.ts` and `helio-mcp/README.md`, prose prefix mentions, `helio_pat_<valid-token>` spec placeholders, elided forms in archived skeptic reports, and `sk-ant-SECRET-SHOULD-NEVER-LEAK-xyz` in the HEL-401 archive. Show the grep of each and the passing gate run.
- [x] 6.4 Record the gate's wall-clock runtime before and after (design "Risks" — scan cost).

## 7. Self-test cases (design Decision 7)

- [x] 7.1 Add `.hel846-`-prefixed cases mirroring 5.1–5.6 into `scripts/check-no-credential-in-agent-surface.selftest.mjs`, following the file's existing subprocess harness convention.
- [x] 7.2 Each planted path is `finally`-guarded **and** cleaned idempotently at startup.
- [x] 7.3 Add the `.hel846-` entries to `.gitignore` alongside the existing `.hel927-`/`.hel956-`/`.hel993-` ones. Note this repo's `.gitignore` uses **exact paths, not globs** for these — follow that convention and list each planted path explicitly, including the Decision 2a scratch plants under `openspec/`, `docs/` and `notes/`. Verify with `git status --short` that no planted path is ever untracked-and-visible.
- [x] 7.4 Mutation-verify the self-test itself: disable `checkDeliverySecrets` in the shipped script and show the new self-test cases go red. Restore. Paste the transcript.
- [x] 7.5 Run the full selftest green and paste it.

## 8. CI enforcement (design Decision 6)

- [x] 8.1 Add `- run: npm run check:no-credential-leak` and `- run: npm run check:no-credential-leak:selftest` to the `frontend` job of `.github/workflows/ci.yml`, placed with the other `check:*` steps.
- [x] 8.2 Add a short comment recording *why* CI and not hook-only, citing the bypassability of the husky chain and the worktree-vacuous `npm test` (HEL-768/HEL-880) — matching the existing HEL-913 precedent comment's style.
- [x] 8.3 Do not modify `.husky/pre-commit`. Do not modify root `jest.config` or jest structure. Do not add a new npm script (both already exist).
- [x] 8.4 Validate the workflow YAML parses (e.g. a Node/`js-yaml` or `python3 -c` parse) and paste the result.

## 9. Documentation (design Decision 5)

- [x] 9.1 Add the redact-and-revoke rule to `CONTRIBUTING.md`: any credential/token/secret minted for live verification is redacted from the transcript **before** the transcript is committed, and revoked when the run ends. Include the mechanical gate that enforces the first half and the marker convention for fixture values.
- [x] 9.2 State in the rule that `.concertino/` and `scripts/concertino/` are render targets and must not be used to hold this rule.
- [x] 9.2a State the **standing repo-wide constraint** from design.md Decision 2a: from this change onward, any file under `openspec/`, `docs/` or `notes/` that quotes a credential-shaped value must carry a documented synthetic marker or elide the value. List the marker set. This is what makes Decision 2's "no evidence file ever needs an allowlist entry" promise true.
- [x] 9.3 Prefer a short-lived/narrowly-scoped credential for verification runs where the API allows it, so a leak's blast radius is smaller by construction (ticket's "consider also").

## 10. Gate chain and handoff

- [x] 10.1 Produce **per-script isolation-test transcripts** for `check-no-credential-in-agent-surface.mjs` and its selftest via `scripts/concertino/test-gate-in-isolation.sh` (CON-132; Delivery's `assert-phase.sh` fails closed without them).
- [x] 10.2 Run the full pre-commit chain and paste the result.
- [x] 10.3 Write `openspec/changes/credential-shaped-string-commit-guard/files-modified.md` declaring every modified path.
- [x] 10.4 Confirm no artifact in this change states or implies that a credential leaked into committed history.
- [x] 10.4a Run the finished gate against the finished change directory and confirm **this change's own committed artifacts pass** (design Decision 2a).
- [x] 10.5 Confirm no planted or fixture value anywhere in the diff is a real credential.
