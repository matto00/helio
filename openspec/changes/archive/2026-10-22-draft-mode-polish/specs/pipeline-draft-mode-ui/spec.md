## ADDED Requirements

### Requirement: Kept drafts end with the session
Kept pipeline drafts SHALL be removed from the tab whenever the app treats the session as ended: an explicit logout,
an API call returning `401` because the session expired, or a page load whose session check fails.

#### Scenario: Session expires while a draft is kept
- **WHEN** a kept draft exists for a pipeline and an API call returns `401` (not an `/api/auth/me` or `/api/auth/mfa` call)
- **THEN** no kept draft remains in the tab's storage, and the next user who signs in does not see it

#### Scenario: Session expired before a reload
- **WHEN** a kept draft exists, the session expires, and the tab is reloaded
- **THEN** the kept draft is removed when the load's session check fails, before anyone signs in again

### Requirement: Draft frames survive a layout switch
Crossing the phone boundary (768px) while a draft exists SHALL keep each client-evaluated step's last good draft
frame, including while a step is in error, so the new layout shows the same counts and rows without waiting for a new
walk. A server-resolved step MAY request its draft preview again after the switch.

#### Scenario: Desktop to phone mid-error
- **WHEN** a draft puts a step in error on desktop, and the viewport then narrows to 375px
- **THEN** the phone layout shows the draft's last good counts and rows for the client-evaluated steps above and at the error, not the saved counts and not a pending state

### Requirement: A restored step is not a created step
A step that reappears because the draft was discarded (or a kept draft was restored) SHALL NOT be treated as newly
created: selection and the phone step sheet SHALL NOT jump to it.

#### Scenario: Discard restores a deleted step
- **WHEN** a draft deletes a saved step and the user discards the draft
- **THEN** the step reappears in the spine and the selected step does not change to it

### Requirement: Draft notices take only their own height
On desktop, a draft notice (stale base, save error) SHALL occupy only its own height in the page; the step body SHALL
start directly below it with no empty band, and the 1280×800 no-document-scroll requirement SHALL still hold.

#### Scenario: Save error notice at 1280
- **WHEN** a draft save is refused with a notice at 1280×800
- **THEN** the gap between the notice's bottom edge and the step body's top edge is at most the page's normal row gap

### Requirement: The run refresh requests only Outputs that still exist
When a run finishes, the page SHALL refresh the previews of the Outputs in the pipeline's current definition only; an
Output removed by the save that started the run SHALL NOT be requested.

#### Scenario: Save & run removes an Output
- **WHEN** a draft deletes a step with an Output, the user confirms the cascade, and the run then succeeds
- **THEN** no request is made for the removed Output and the console shows no 404
