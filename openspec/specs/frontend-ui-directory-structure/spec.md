# frontend-ui-directory-structure Specification

## Purpose
Keeps each `frontend/src/features/<feature>/ui/` directory scannable by grouping its files into role-named
subdirectories, so page-level components stay visible among their supporting parts; and defines what a
directory-segmentation change may alter — locations and path specifiers only, as a pure rename.
## Requirements
### Requirement: Feature UI directories are segmented by role

A `frontend/src/features/<feature>/ui/` directory SHALL group its files into role-named subdirectories rather than
presenting a flat listing, so that page-level components remain visible among their supporting parts. Page-level
components, shared affordances, and cross-cutting utilities of a feature SHALL remain at the `ui/` root.

#### Scenario: Step-op config components are grouped

- **WHEN** a pipeline step-op config component and its test are added to `features/pipelines/ui/`
- **THEN** both files live in `features/pipelines/ui/stepConfigs/`
- **AND** the `ui/` root listing is unchanged by their addition

#### Scenario: StepCard remains at the pipelines UI root

- **WHEN** a contributor follows the pipeline-op wiring checklist to wire a new op into `StepCard`
- **THEN** `StepCard.tsx` and `StepCard.test.tsx` are found at the `features/pipelines/ui/` root
- **AND** they are not located in any subdirectory

#### Scenario: Panel detail modal parts are grouped

- **WHEN** a `PanelDetailModal.*` component, stylesheet, or test is added to `features/panels/ui/`
- **THEN** the file lives in `features/panels/ui/detailModal/`

#### Scenario: Per-source-type forms are grouped

- **WHEN** a per-source-type form component is added to `features/sources/ui/`
- **THEN** the file lives in `features/sources/ui/forms/`
- **AND** source pages and shared affordances remain at the `features/sources/ui/` root

### Requirement: Co-located companion files move with their component

A component's co-located stylesheet and tests SHALL reside in the same directory as the component itself. A test that
reads a file from disk SHALL resolve that path relative to its own directory, so that relocating the group does not
break the read.

#### Scenario: A component is relocated into a subdirectory

- **WHEN** a component is moved from a `ui/` root into one of its role-named subdirectories
- **THEN** its co-located stylesheet and every co-located test move with it in the same change
- **AND** no test resolves a companion file through a repository-root-relative path

#### Scenario: A CSS-content test reads its stylesheet after relocation

- **WHEN** a CSS-content test that reads a stylesheet from disk is relocated together with that stylesheet
- **THEN** the test resolves the stylesheet relative to its own directory and continues to pass
- **AND** the assertion it makes is unchanged by the relocation

### Requirement: Directory segmentation preserves file content

A change whose purpose is to segment a UI directory SHALL alter only file locations and the path specifiers needed to
reach relocated files. Every relocated file SHALL be recorded by version control as a rename, and no relocated file's
content SHALL differ except in its import or path-specifier lines.

#### Scenario: Segmentation change is reviewed

- **WHEN** a directory-segmentation change is inspected against its base commit
- **THEN** every affected path is reported as a rename rather than as an addition plus a deletion
- **AND** the per-feature file count is identical before and after

#### Scenario: A relocated file's body is altered

- **WHEN** a relocated file differs from its original in a line that is not an import or path specifier
- **THEN** the segmentation change is rejected as no longer a pure move

