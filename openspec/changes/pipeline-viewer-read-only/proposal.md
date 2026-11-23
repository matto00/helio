## Why

HEL-1661 hid the run entries from a viewer grantee on a shared pipeline's detail page and added "View only", but every other edit affordance is still offered to the viewer: editing steps into a client-only draft, adding, moving, duplicating, disabling and removing steps, renaming the pipeline, setting/editing/pausing the schedule, adding sources, and creating, editing and deleting Outputs. The server refuses every one of them, so a viewer can build a draft that can never be saved, or fill a form whose save fails. HEL-1782 already hides edit affordances from dashboard viewers; the pipeline page should match.

## What Changes

- One role-derived predicate (`canEditFromUi`, from the existing HEL-1661 `usePipelineRunRole`) decides whether the pipeline detail page offers edit affordances. Owners and editors are unchanged; a viewer (and the `pending` state before the role is known) is offered none.
- Desktop (spine layout) and phone (mobile layout, including the phone step sheet): every edit affordance in the inventory recorded in design.md is hidden for a viewer. Read-only views stay: a viewer can still select a step and read its configuration (rendered inside a disabled fieldset, with no Disable/Duplicate/Remove actions and no step-actions menu), open an Output to see its preview and its configuration in disabled fields (no Save/Delete), and open run history (already run-entry free per HEL-1661). A viewer sees no schedule control: a grantee never receives the schedule from the server (owner-only schedule routes; follow-up).
- A viewer cannot create a client-only draft: the draft overlay's mutators are no-ops when the page is not editable (defence in depth behind the hidden UI). A draft that already exists (e.g. restored from the tab's sessionStorage after a role change) is still shown with Discard only (owner ruling on HEL-1661 Q2); Save & run stays hidden for a viewer.
- Viewer-facing copy that invites an edit or run ("Run the pipeline to populate it." in the Output sheet preview, "Run the pipeline to start recording this Output's history." in Output history — deferred to this ticket by HEL-1661's audit) gets a viewer variant.
- e2e (red first): viewer on desktop and phone, light and dark, sees no actionable edit control and cannot create a draft; an editor control keeps every control.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-detail-spine-layout`: a viewer grantee is offered no edit affordance on the desktop pipeline page, and cannot create a draft.
- `pipeline-detail-mobile-layout`: a viewer grantee is offered no edit affordance on the phone pipeline page, including the step sheet.

## Impact

- Frontend only: `frontend/src/features/pipelines/**` (hooks: `usePipelineRunRole`, `usePipelineDraft`, `usePipelineDetailPage`; UI: spine header/spine/step row/outputs/source card/schedule chip, `StepCardFocused`, mobile header/actions/step sheet/layout, `PipelineDetailDialogs`, Output editor sheet, Output history copy). Memo comparators added by HEL-1809 (`SpineStepRow`, `SpineOutputs`) must account for any new prop.
- No backend change, no API or schema change, no migration. The server remains the authority (it already refuses every viewer write).
- New e2e spec reusing `e2e/support/hel1661Fixture.ts`.
