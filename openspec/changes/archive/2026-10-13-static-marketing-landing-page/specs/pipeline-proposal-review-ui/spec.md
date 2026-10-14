## MODIFIED Requirements

### Requirement: Combined proposal accept/reject
Accepting a combined proposal SHALL call `POST /api/proposals/apply` with the reviewed proposal
and, on success, navigate away from the review page with the newly-created dashboard available in
the app's dashboard list without requiring a full page reload. Rejecting SHALL discard the
proposal and navigate away without any backend write.

#### Scenario: Accepting a combined proposal
- **WHEN** the user clicks Accept on the combined proposal review page
- **THEN** the system calls `POST /api/proposals/apply` with the combined proposal, and on success
  navigates to `/home` with the created dashboard selected

#### Scenario: Accept fails
- **WHEN** `POST /api/proposals/apply` returns an error
- **THEN** the page displays the error inline and remains on the review page (no navigation)

#### Scenario: Rejecting a combined proposal
- **WHEN** the user clicks Reject on the combined proposal review page
- **THEN** no request is sent to `/api/proposals/apply` and the user is navigated away from the
  review page
