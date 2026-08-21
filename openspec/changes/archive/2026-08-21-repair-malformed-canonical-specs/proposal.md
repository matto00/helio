## Why

26 canonical specs under `openspec/specs/` are structurally malformed and abort `openspec archive`
mid-delivery — after the code has already merged. This fired twice today (HEL-528, HEL-548), both
times discovered by a delivery breaking rather than by an audit.

Measured against the real parser at base `785e0af9`, the ticket's framing is wrong in three ways:

1. **The heading rename alone does not fix it.** 19 of the affected files are raw delta files with no
   `## Purpose`. Renaming the heading makes the parser *see* the requirements, but `openspec archive`
   then aborts a second time on `Spec must have a Purpose section` — proven end-to-end, not inferred.
2. **`ADDED`-only deltas do not archive fine.** The ticket says only `MODIFIED`/`REMOVED` abort. In
   fact any delta of any kind against the 24 no-Purpose capabilities aborts today.
3. **The set is 26, not 22.** 21 files carry the stray heading; 5 more are malformed in ways neither
   prior run reported, including one carrying a stray `## MODIFIED Requirements`.

## What Changes

- Repair all 26 files in four classes: rename stray `## ADDED`/`## MODIFIED Requirements` to
  `## Requirements`, merge duplicate sections, and add a `## Purpose` where absent. Requirement text,
  scenarios and ordering are preserved byte-for-byte, save the one bounded exception in Non-goals.
- Add a guard enforcing one invariant — the requirement sets seen by the delta parser, by the validator,
  and present in the file must be identical, with zero validator errors. A parser-only or heading-only
  check was proven during design review to miss cases that still abort a real archive.
- Verify the two in-flight repairs (`shared-status-message`, `frontend-panel-empty-state`).

## Capabilities

### New Capabilities
- `openspec-spec-hygiene`: structural guarantees for canonical specs under `openspec/specs/` — every
  spec parses, validates, and exposes all its requirements to the delta parser, enforced pre-commit.

## Impact

- `openspec/specs/<26 capabilities>/spec.md` — structural repair only, no requirement text altered.
- `scripts/` — a new standalone guard, invoked from `.husky/pre-commit` as its own line **before**
  `npm run check:openspec`, deliberately not folded into that script (see design.md decision 2).
- Unblocks archive for 24 capabilities that would otherwise abort a future delivery.

## Non-goals

- Rewriting, merging, splitting or re-scoping any requirement. One bounded exception (design.md 3a):
  a single scenario added to `schema-inference`'s `InferredSchemaResponse wire format`, restating the
  SHALL sentence already in the file. It is scenario-less, which the validator rejects as a hard ERROR
  once the repair makes it visible; it is the only such requirement in all 316 specs. Restating existing
  text neither loses nor alters a requirement, so the verbatim rule's purpose is preserved.
- Fixing the upstream archive step that originally wrote these files (out of our tree).
- Touching `openspec/changes/` beyond this change's own directory.
- Repairing the 41 specs that lack a `# Title` heading — proven not load-bearing for the parser or
  validator, so they are well-formed as-is.
