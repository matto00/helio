# HEL-1466: After HEL-1405: remaining stale DataType/bound-content specs (mcp-panel-composition-tools, markdown-panel config.content, panel-content-sizing) and dead TextRenderer bound path; root `npm test -- --testPathPatterns` doesn't narrow

## Description

Origin: HEL-1405 (matto00/helio#909, 428e1d2d), lane-reported. Follow-up label.

1. `openspec/specs/mcp-panel-composition-tools/spec.md`: the collection scenario still says "bound to the DataType" (~:69), the "source-companion DataType id" scenario remains (~:78), and the `propose_dashboard` type-set requirement (~:42) is stale (the current set is text, markdown, image, output).
2. `markdown-panel` spec: requirements 1–2 describe a top-level `content` where the real field is `config.content`; "Non-markdown panels have null content" wrongly lists `text`.
3. `panel-content-sizing/spec.md:47-53` has text-panel "bound data" scenarios; `TextRenderer.tsx` keeps a dead `data?.content` bound path. Remove both, with a guard test.
4. **Dev-docs bug:** root `npm test -- --testPathPatterns=X` does NOT narrow to the pattern (it runs the full suite); `npm --prefix frontend test -- --testPathPatterns=X` does. CLAUDE.md documents the root form as the single-file command. Verify, then fix the script or the doc.
5. Minor: the new `panel-cross-filtering` requirement paraphrases rather than quotes the narrowing requirement's wording.

All via proper OpenSpec deltas; verification command per factual claim.

## Acceptance Criteria

- Items 1, 2, 3 (spec half), 5 are corrected through OpenSpec MODIFIED deltas; every factual claim in each delta has a verification command recorded in the change's evidence file.
- `TextRenderer` no longer accepts or reads bound `data`; a guard test proves a text panel renders only `config.content` (failable by mutation: reintroducing the `data?.content` read turns it red).
- Item 4 is verified empirically (root form vs prefix form) and fixed in either the script or CLAUDE.md's command documentation only.
- Each item is re-derived against the current tree; any already-fixed item is dropped with evidence.

## Run notes (driver)

Runs overnight, unattended. Non-UI: no user-visible change expected; if one turns up, or a product call that is not easily reversible, escalate and stop with state saved. Premise validation (2026-10-14): all five items confirmed still present; one minor staleness — the current proposal panel type set is text, markdown, image, output, **form** (HEL-1148 added `form`).
