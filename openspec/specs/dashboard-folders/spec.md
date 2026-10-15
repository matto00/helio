# dashboard-folders Specification

## Purpose
Per-user folders for organising the dashboards a user can see in the context list, persisted server-side so the same
grouping appears on every device; filing a dashboard never affects any other user or any grant.

## Requirements

### Requirement: Folders are private to the user who creates them
A folder SHALL belong to exactly one user. No API response SHALL expose another user's folders or filings, and the
database SHALL enforce this with row-level security that holds for a non-BYPASSRLS session.

#### Scenario: Another user's folders are invisible
- **WHEN** user B calls `GET /api/dashboard-folders` after user A created folders
- **THEN** none of A's folders or filings appear

#### Scenario: RLS blocks a cross-user read without application filtering
- **WHEN** a non-BYPASSRLS session with `app.current_user_id` set to B selects from the folder tables
- **THEN** no row belonging to A is returned, and an insert of a row owned by A is rejected

### Requirement: Folder CRUD
`GET /api/dashboard-folders` SHALL return `{folders: [{id, name, collapsed, createdAt}], assignments: [{dashboardId,
folderId}]}`, folders ordered by creation time, assignments only for dashboards the caller can currently access.
`POST /api/dashboard-folders` `{name}` SHALL create a folder (201). `PATCH /api/dashboard-folders/:id` `{name?,
collapsed?}` SHALL rename and/or set collapsed state. `DELETE /api/dashboard-folders/:id` SHALL delete the folder (204)
and leave its dashboards unfiled. Names SHALL be trimmed, 1..80 characters, unique per user case-insensitively
(`409` on a duplicate, `400` on an invalid name). An unknown or another user's folder id SHALL return `404`.

#### Scenario: Create and rename
- **WHEN** the user creates "Daily" then renames it to "Morning"
- **THEN** `GET /api/dashboard-folders` lists one folder named "Morning"

#### Scenario: Duplicate name rejected
- **WHEN** the user creates "daily" while "Daily" exists
- **THEN** the response is 409 and no folder is created

#### Scenario: Deleting a folder unfiles its dashboards
- **WHEN** a folder holding two dashboards is deleted
- **THEN** both dashboards still exist and appear unfiled

### Requirement: Move a dashboard between folders
`PUT /api/dashboards/:id/folder` `{folderId: string | null}` SHALL file the dashboard in that folder (replacing any
previous filing by the same user) or unfile it when `null`, returning 204. The dashboard SHALL be one the caller can
access (owned or granted), else `404`; the folder SHALL be the caller's own, else `404`.

#### Scenario: Move between folders
- **WHEN** a dashboard filed in "Daily" is moved to "Work"
- **THEN** it appears only in "Work"

#### Scenario: A granted dashboard can be filed without affecting the owner
- **WHEN** a viewer grantee files a shared dashboard in their folder
- **THEN** the owner's folders and the grant are unchanged

### Requirement: Folders in the dashboards context list
The dashboards context list SHALL show each folder with a disclosure control, its name and a count of the dashboards it
holds, followed by an "Unfiled" group, with the filter applying across all groups. The user SHALL be able to create a
folder, rename it inline, delete it, collapse/expand it (persisted via the API), and move a dashboard to a folder or to
Unfiled from that dashboard's row actions with the keyboard. When the user arrives at a dashboard filed in a collapsed folder, that folder SHALL be revealed once, without saving;
after that the disclosure control SHALL always toggle what is shown, including for the open dashboard's folder, and
save that state.

#### Scenario: Collapse persists across reloads
- **WHEN** the user collapses "Work" and reloads
- **THEN** "Work" is still collapsed and its count is still shown

#### Scenario: The open dashboard's folder can be collapsed
- **WHEN** the user collapses the folder holding the open dashboard
- **THEN** the folder collapses and `collapsed: true` is saved
