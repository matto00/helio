## ADDED Requirements

### Requirement: Draft step preview columns follow the step's schema, with no request
While a draft exists, the "Rows after step N" grid SHALL order its columns the way the server's analyze projection of the step orders them, never by the arrival order of the rows' keys, and SHALL obtain that order without sending any network request (the "Client-evaluable edits recompute locally with no request" requirement holds unchanged). A root's columns, and the columns a join, union or lookup takes from a source secondary, SHALL follow that source's declared schema; a step SHALL keep its parent's column order for the columns it passes through, place a renamed column where the original was, and place the columns it creates where the server's projection of that step places them. For a step whose rows come from the draft-preview server, the grid SHALL use the step's saved analyzed order when nothing it depends on (its own and its ancestors' steps, its root binding, and every lane or source secondary it reads) differs from the saved pipeline, and otherwise its nearest client-evaluated ancestor's order, with columns that ancestor lacks after it in ascending code-unit order. When no declared order is known (a source neither the saved analysis nor the caller's own source list describes), its columns SHALL be in ascending code-unit order. Rows lacking some columns SHALL NOT change the order.

#### Scenario: Rows whose keys arrive out of schema order
- **WHEN** a draft is open on a source declared `id, name, region, amount, created_at, status` whose sample rows arrive with their keys in a different order
- **THEN** the grid's headers for a client-evaluated step read `id, name, region, amount, created_at, status`, and no request is sent by the edit

#### Scenario: A draft edit renames a column
- **WHEN** the draft renames `region` to `area` in the shown step
- **THEN** the grid's headers read `id, name, area, amount, created_at, status`, every step below it keeps `area` in that position, and no request is sent

#### Scenario: A step the draft added
- **WHEN** the draft inserts a compute step that adds `total`
- **THEN** that step's headers are its parent's columns in order, then `total`

#### Scenario: Join with a source secondary
- **WHEN** a client-evaluated join takes columns from a source secondary whose sample rows arrive in hash key order
- **THEN** the appended columns follow the secondary source's declared schema

#### Scenario: A server-resolved step
- **WHEN** the shown step is resolved by the draft-preview transport and its rows arrive with keys in hash order
- **THEN** the grid's headers follow the step's saved analyzed order if nothing it depends on changed in the draft, else its nearest client-evaluated ancestor's order with the step's new columns after in code-unit order

### Requirement: The last-good-frame fallback keeps its truncation flag
When a server-resolved step's result is `ok` but no `rows` line has arrived for it, and the view falls back to the step's last good frame, the view SHALL report that frame's own truncation flag, so a frame that was cut at the 1,000-row cap is never treated as complete.

#### Scenario: Fallback to a truncated last good frame
- **WHEN** a step's last good frame was a `rows` line with `truncated: true`, and a new request answers the step `ok` with no `rows` line
- **THEN** the step view shows the last good rows as stale and reports `truncated: true`
