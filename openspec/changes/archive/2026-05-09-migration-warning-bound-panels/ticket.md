# HEL-213 — Migration warning for directly-bound panels

## Title
Migration warning for directly-bound panels

## Description
Identify any panels that are still bound directly to a Data Source (pre-v1.3 data). Display an inline warning banner on those panels in the grid prompting the user to attach a pipeline. Panel continues to render its last known data until migrated.

## Context
This is the final ticket in the HEL-145 epic ("Type Registry as Defacto Panel Source"). Sibling tickets:
- HEL-210: Remove direct DataSource → Panel binding path (merged)
- HEL-211: (merged)
- HEL-212: Empty state for no data types (merged)

After HEL-210, the backend no longer accepts new direct DataSource→Panel bindings. However, legacy panels created before v1.3 may still have a `dataSourceId` field set. These panels need a visible migration warning so users know they must re-attach via a pipeline.

## Acceptance Criteria
1. Panels with a non-null `dataSourceId` (and no pipeline attached) are identified as "legacy-bound"
2. An inline warning banner is displayed on those panels in the dashboard grid
3. The banner prompts the user to attach a pipeline
4. The panel continues to render its last known data (does not break)
5. The warning is dismissible or simply informational (does not block usage)
