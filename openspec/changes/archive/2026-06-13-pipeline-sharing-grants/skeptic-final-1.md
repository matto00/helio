## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Acceptance criteria trace**

AC1 — Pipeline owner can grant viewer or editor role via share UI:
- `PipelinePermissionRoutes.scala`: GET/POST/DELETE `/api/pipelines/:id/permissions` routes, owner-gated via `accessChecker.requireOwnerOnly`.
- `PipelineShareDialog.tsx`: modal with grantee user-ID input + role selector + "Grant access" button. Wired into `PipelinesPage.tsx` (row share button) and `PipelineDetailPage.tsx` (owner-only share bar).
- UI walkthrough confirmed: share button visible in list row (light + dark) and detail page; dialog opens and renders correctly. `GET /api/pipelines/:id/permissions` returns 200 on dialog open.
- `isOwner` guard confirmed in `PipelineDetailPage.tsx:209–213`.
- CONFIRMED.

AC2 — Viewer grantee can read pipeline + steps + runs + stream events; cannot mutate:
- `PipelineService.findSummaryById`, `listSteps`, `analyze` all call `findByIdShared` — owner + grantees pass.
- `PipelineService.addStep`, `updateStep`, `deleteStep` call `requireEditorAccess` after `findByIdShared` confirms existence; viewer grantees get `Left(Forbidden)`.
- `PipelineRunService.history` and `previewStep` call `findByIdShared` — viewers can read run history and trigger previews (noted below).
- `PipelineRunStreamRoutes.scala` uses `pipelineExistsShared` — viewers can subscribe to SSE.
- `PipelineSharingAclSpec.scala`: viewer coverage in `helio_can_access_pipeline` (returns TRUE for viewer grantee — line 196) and `RLS on pipelines (SELECT)` (viewer sees pipeline — line 255).
- CONFIRMED.

AC3 — Editor grantee can mutate steps + trigger runs; cannot delete or transfer ownership:
- `PipelineService.delete` and `updateName` call `pipelineRepo.findByIdOwned` (lines 106, 119), which returns None for non-owners → 404 (existence not leaked).
- `PipelineRunService.submit` checks grant role; only `"editor"` can trigger runs (lines 68–70).
- No ownership-transfer endpoint exists — not a gap.
- `requireEditorAccess` in `PipelineService` (line 370) returns `Right(())` only for `"editor"` role.
- CONFIRMED.

AC4 — Cross-user with no grant → 404:
- `findByIdShared` returns None for caller without a grant (line 73 of PipelineRepository.scala — `hasGrant` check).
- `PipelineRepositorySpec` regression test: `findByIdShared` returns None for non-grantee callers (file listed in files-modified.md).
- `PipelineSharingAclSpec`: "withUserContext(unrelated) does NOT see pipeline with no grant" — line 261.
- CONFIRMED.

AC5 — Test matrix: owner / editor / viewer / no-grant:
- `PipelineSharingAclSpec.scala` covers all four actors: `helio_can_access_pipeline` tests (TRUE for owner, TRUE for editor, TRUE for viewer, FALSE for unrelated); `RLS on pipelines (SELECT)` (owner sees, editor+grant sees, viewer+grant sees, unrelated does not see).
- `RLS on resource_permissions (pipeline grants)` covers owner sees all rows, editor/viewer see only own row, unrelated sees zero, unrelated cannot INSERT grant on pipeline they don't own.
- sbt test run (fresh): `Tests: succeeded 827, failed 0` across 50 suites — confirmed by running `cd backend && sbt test` in worktree. All 50 suites completed.
- CONFIRMED.

AC6 — Frontend share dialog supports pipelines:
- `PipelineShareDialog.tsx` + `PipelineShareDialog.css` — new files.
- Share button in `PipelinesPage` row (owner-only via `currentUserId` + `ownerId` check) and `PipelineDetailPage` header (owner-only via `isOwner` derived check).
- UI walkthrough: dialog renders correctly in both dark and light themes; empty state, grant form, Done button all functional. No console errors.
- CONFIRMED.

**Iron Laws — verification evidence**

- `npm run lint`: exit 0, zero warnings (ran fresh).
- `npm run format:check`: "All matched files use Prettier code style!" (ran fresh).
- `npm test`: 692 tests, 60 suites, 0 failures (ran fresh).
- `sbt test`: 827 tests, 50 suites, 0 failures (ran fresh).

**Evaluator cycle-2 change requests — re-verified**

- CR1 (ResourceAccess import): `grep -n "ResourceAccess" PipelineService.scala` returns no output. RESOLVED.
- CR2 (`--app-error` tokens): `PipelineShareDialog.css` lines 58 and 81 confirmed to use `color: var(--app-error)`. No hardcoded hex. RESOLVED.
- CR3 (space tokens): `.pipeline-list-table__share-btn { padding: var(--space-1) var(--space-2); }` confirmed in diff. RESOLVED.
- CR4 (findByIdOwned): `PipelineService.delete` and `updateName` confirmed to call `pipelineRepo.findByIdOwned`. RESOLVED.

**Design compliance — mechanical token check**

New CSS additions (confirmed from diffs):
- `PipelinesPage.css` additions: all padding/gaps use `--space-*`, all colors use `--app-*`, radius uses `--app-radius-md`, transition uses `--app-transition`, font-size uses `--text-xs`. Clean.
- `PipelineDetailPage.css` additions: all padding/gaps use `--space-*`, all colors use `--app-*`. Clean.
- `PipelineShareDialog.css`: all spacing uses `--space-*`, all colors use `--app-*`, all font-sizes use `--text-*`, radius uses `--app-radius-*`. Clean.

**Design compliance — judgment**

Light and dark parity: confirmed via screenshots. Dialog is readable in both themes. Token-based colors adapt correctly.

Empty state: "No grants yet." renders as a plain paragraph, not `EmptyState` component — but this is inside a modal section, not a full-page or main-panel empty state. The DESIGN.md §5 note about `EmptyState` targets "Empty states" in data-backed views; a two-word "no items in list" within a modal section is a common inline pattern. Acceptable.

**Design compliance — FAIL: native `<select>` instead of shared `Select` component**

`PipelineShareDialog.tsx` uses a raw `<select>` element:
```tsx
<select
  className="pipeline-share-dialog__select"
  value={role}
  onChange={(e) => setRole(e.target.value as GrantRole)}
  ...
>
  <option value="viewer">Viewer</option>
  <option value="editor">Editor</option>
</select>
```

`PipelineShareDialog.tsx` is the **only** file in the entire frontend codebase (outside `Select.tsx` itself) that uses a raw `<select>` element. DESIGN.md §5 says: "Use these; do not hand-roll equivalents." The shared `Select` component (`frontend/src/shared/ui/Select.tsx`) is a portal-based custom dropdown that **specifically handles the modal portal case** (line 51: "Portal into the nearest open `<dialog>` if present so the listbox renders in the dialog's top layer"). `CreatePipelineModal.tsx` in the same feature directory already imports and uses `Select`. Using a native `<select>` inside a modal foregoes the in-dialog portal handling and diverges visually from every other dropdown in the app.

This is a concrete DESIGN.md §5 violation: a hand-rolled equivalent where the shared component exists and was designed for this exact use case.

### Verdict: REFUTE

### Change Requests

1. **Replace the native `<select>` in `PipelineShareDialog.tsx` with the shared `Select` component.**

   In `frontend/src/features/pipelines/ui/PipelineShareDialog.tsx`:
   - Add import: `import { Select } from "../../../shared/ui/Select";`
   - Replace the `<select>` element and its `<option>` children with:
     ```tsx
     <Select
       value={role}
       onChange={(v) => setRole(v as GrantRole)}
       ariaLabel="Grant role"
       disabled={adding}
       options={[
         { value: "viewer", label: "Viewer" },
         { value: "editor", label: "Editor" },
       ]}
     />
     ```
   - Remove the `.pipeline-share-dialog__select` CSS rule from `PipelineShareDialog.css` (the shared `Select` component brings its own `ui-select__trigger` styling from `inputs.css`).

   Rationale: DESIGN.md §5 binding rule; `Select` is the only dropdown primitive in use across the app; it handles the dialog top-layer portal scenario (`CreatePipelineModal.tsx` in the same feature directory already uses it correctly).

### Non-blocking notes

- `PipelineRunService.previewStep` allows viewer grantees to trigger a step preview (it calls `findByIdShared` but has no editor-only gate). The ticket says "Viewer grantee can read pipeline + steps + runs + stream events" — preview is arguably a read operation (returns data without persisting), so this is defensible. But it is not explicitly called out in the AC, and preview does consume backend compute. If the intent is "viewers can only read persisted state," add an editor check to `previewStep` as a follow-up. No action required here.
- `PipelineSummary.ownerId: String = ""` default is a latent footgun (pre-existing, not introduced here). Future callers initializing the case class without setting `ownerId` will silently get an empty string. Non-blocking per the evaluator's prior note.
