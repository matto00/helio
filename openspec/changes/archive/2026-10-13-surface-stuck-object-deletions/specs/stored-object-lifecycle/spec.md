## ADDED Requirements

### Requirement: A row stuck at the attempt cap is re-armed after a cool-down
A queued stored-object deletion whose failed-attempt count has reached the drain's attempt cap SHALL NOT be claimed
until 24 hours have passed since its last attempt. After that, a deletion pass SHALL re-arm it: its attempt count is
reset and it is retried under the normal backoff, for both legacy (V128) and new-style (V132) queue rows. A re-armed
row SHALL go through the same reference check as any other claimed row, so it is deleted only if nothing still
references its key. A row that keeps failing SHALL reach the cap again and wait another 24 hours. A row at the cap
with no recorded last attempt SHALL NOT be re-armed. Re-arming SHALL NOT delete a queue row or a stored object by
itself.

#### Scenario: Stuck row inside the cool-down stays stuck
- **WHEN** a row reached the attempt cap 23 hours 59 minutes ago
- **THEN** a deletion pass neither claims nor re-arms it, and it still counts as stuck

#### Scenario: Stuck row is retried after the cool-down
- **WHEN** a row reached the attempt cap 24 hours 1 minute ago and storage deletes now succeed
- **THEN** a deletion pass re-arms it, the object is removed and the row leaves the queue

#### Scenario: Re-armed row still honours references
- **WHEN** a stuck row is re-armed while a surviving row still references its key
- **THEN** the object is kept

#### Scenario: Capped row without a recorded attempt
- **WHEN** a row is at the attempt cap with no recorded last attempt
- **THEN** a deletion pass does not re-arm it and it still counts as stuck

#### Scenario: Persistent failure reaches the cap again
- **WHEN** a re-armed row keeps failing
- **THEN** it reaches the attempt cap again and is not claimed for another 24 hours
