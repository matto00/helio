## Why

HEL-956 widened `check:no-credential-leak` and closed a class of "silence reads as green" defects, but its own
review found residual paths where the gate still prints a confident OK over something it did not verify. (The script header's
"Other known residual limits" block records three *different*, still-true limits — the exact-word `credential`
match, relative-only import extraction, and the entropy bound — not these. HEL-993's residuals were recorded on the
ticket, and the entry-guard comment claims that path was already fixed.) This change closes them.

## What Changes

- A file that `readFileSync` cannot read is a **hard failure**, not a silent skip. Today the `catch { continue }`
  in `runChecksForSurface` (and in `findBannedImport`'s BFS) drops the file while it still contributes to the
  reported scan count — a planted credential at `helio-mcp/.probe.ts` with mode `000` yields
  `OK (83 files scanned ... 0 violations)` at exit 0. The same shape covers a symlink-to-directory inside an
  `allNonBinary` surface, where `readFileSync` throws `EISDIR`.
- A directory the gate cannot list is likewise a hard failure. `collectFiles`'s `catch { return out }` silently
  drops every file beneath an unlistable directory without tripping the vacuity check — the same defect class,
  found by this change's design gate rather than by HEL-956, and closed here rather than deferred.
- The reported scan count counts only files the gate actually read.
- The CLI entry guard becomes fail-closed in shape: if the entry comparison is ever false while this module is the
  process entry, the gate errors instead of exiting 0 having printed nothing.
- The pre-existing assistant-surface `importGraph` and `credentialProp` checks gain self-test cases, each
  mutation-verified against the shipped script's source.
- The script header gains entries recording which paths HEL-993 closed; the three unrelated residual limits already
  listed there stay.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-surface-credential-gate`: adds an unreadable-file failure requirement and an entry-guard requirement, and
  widens the self-test requirement — which today explicitly scopes itself out of `importGraph`/`credentialProp` —
  to cover them.

## Non-goals

- Extending the `credential`-property ban beyond the assistant surface. `helio-mcp` names eight fields `credential`
  precisely in order to reject them; banning the identifier there would degrade the property the gate protects.
- Replacing the explicit surface table with whole-repo-minus-exclusions coverage.
- Any new allowlist or exclusion entry as a way to resolve a finding.

## Impact

`scripts/check-no-credential-in-agent-surface.mjs`, its self-test, and the
`openspec/specs/agent-surface-credential-gate` spec. No product code, no migration, no e2e.
