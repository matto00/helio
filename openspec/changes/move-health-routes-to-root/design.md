## Context

See proposal.md - Why. Premise validation (persisted at Setup) confirmed: `HealthRoutes.scala`
is at `backend/src/main/scala/com/helio/api/routes/workspace/HealthRoutes.scala`, package
`com.helio.api.routes.workspace`; its sole external reference is `ApiRoutes.scala:235`
(`private val health = new HealthRoutes()`), resolved today via the wildcard import
`import com.helio.api.routes.workspace._`; no `com.helio.api.routes._` (root) wildcard import
currently exists in `ApiRoutes.scala`. No test file imports the class or package — both
`ApiRoutesSpec.scala` and `ApiRoutesCorsErrorHandlingSpec.scala` exercise `/health` only via the
HTTP path string `Get("/health")`.

## Goals / Non-Goals

**Goals:**
- Relocate `HealthRoutes.scala` to `api/routes/` root with zero behavioral change, per the
  owner's ruling recorded on HEL-811.
- Keep both `README.md` files (root and `workspace/`) accurate to the new placement.

**Non-Goals:**
- Re-litigating root vs. `workspace/` — already decided by the owner.
- Any change to `/health`'s response shape, status code, or its position in the `~` mount chain
  in `ApiRoutes.scala` (it stays `health.routes ~` as the first alternative, outside
  `pathPrefix("api")` and every auth directive — only the import resolving `health.routes`'s
  defining class changes, not the mount itself).

## Decisions

**D1 — `git mv`, not copy+delete.** Preserves file history. HEL-632's iron constraint (`git mv` +
package + imports + READMEs only, no logic/signature changes) applies unchanged from the parent
epic.

**D2 — Add one new import line rather than reusing an existing wildcard.** `ApiRoutes.scala` has
no `import com.helio.api.routes._` today (confirmed in premise validation). Two alternatives
considered:
  - Add `import com.helio.api.routes._` (wildcard) — rejected: would also (harmlessly, but
    needlessly) pull in `ServiceResponse` by wildcard where it's otherwise referenced by
    qualified name or not at all in this file; a single explicit import
    (`import com.helio.api.routes.HealthRoutes`) is the minimal, precise diff.
  - Add `import com.helio.api.routes.HealthRoutes` (chosen) — smallest possible surface, mirrors
    the file's own single-class move.

**D3 — README updates mirror HEL-633's existing pattern, and must fix the now-false summary
sentence.** `api/routes/README.md` already documents one root-level exception
(`ServiceResponse.scala`) with rationale; add `HealthRoutes` as a second bullet in the same style.
Critically, that same README's line 12 currently reads "No other file lives directly in
`api/routes/` — every route class belongs under one of the 13 domain subdirectories." This
sentence is true today only because `ServiceResponse.scala` is a helper, not a route class. Once
`HealthRoutes.scala` — which IS a route class, mounted as `health.routes ~` in `ApiRoutes.scala`
— moves to root, this sentence becomes literally self-contradictory with the bullet added just
above it (design-gate skeptic round 1 REFUTE, 2026-09-22). It must be rewritten to acknowledge
that `HealthRoutes` is the one route class exceptionally placed at root (e.g. "Every route class
belongs under one of the 13 domain subdirectories, with one exception: `HealthRoutes`, which
mounts outside every domain's auth/prefix scope — see the bullet above"), not merely have a
bullet appended beneath an unchanged, now-false claim. Then update `workspace/README.md`'s
"Holds" list to drop `HealthRoutes` and adjust its explanatory sentence.

## Gate-Chain Implications Checklist

Not applicable — this change touches no `.husky/**` file and no script invoked by
`.husky/pre-commit`.

## Risks / Trade-offs

- [Risk] Missing the `ApiRoutes.scala` import update would fail compilation immediately —
  mitigated by `sbt test` (which compiles `main` first) as a required verification gate before
  commit.
- [Risk] Stale README text after the move — mitigated by explicitly listing both README files as
  in-scope artifacts in tasks.md.

## Migration Plan

Single commit, no runtime migration: `git mv` + package/import edits + README edits, verified by
`sbt test`. No deploy-time behavior change, no rollback complexity beyond a normal revert.
