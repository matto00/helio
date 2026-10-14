## MODIFIED Requirements

### Requirement: PageHeader provides a consistent title/eyebrow/actions/back-link header
The system SHALL provide a `PageHeader` component in `frontend/src/shared/ui/` accepting a required
`title` string (rendered as an `<h1 className="page-title">`, in the heading face per DESIGN.md §3 typography), an
optional `eyebrow` string (rendered via the `.eyebrow` utility above the title), an optional `actions`
slot (rendered trailing, e.g. buttons), and an optional `backTo`/`onBack` affordance (rendered leading,
for detail routes). Omitting any optional prop SHALL render nothing for that slot rather than an empty
wrapper element.

#### Scenario: A list route's minimal header
- **WHEN** `PageHeader` is rendered with only `title="Data Sources"`
- **THEN** the title renders as an `<h1 className="page-title">` and no eyebrow, actions, or back link
  elements are present in the DOM

#### Scenario: A detail route's header with a back link and actions
- **WHEN** `PageHeader` is rendered with `title`, `backTo`, and `actions`
- **THEN** the back affordance renders before the title and the actions render after it, in a single
  header row

