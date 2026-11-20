## ADDED Requirements

### Requirement: Recent resources end with the session
The recent-resource history SHALL NOT survive the end of a session. When the user signs out, or the
client is signed out because the server rejected the session, the recorded history SHALL be discarded
from the browser, so the next person to sign in on that browser is never offered the previous user's
recent resources.

#### Scenario: A different user signing in on the same tab sees no inherited recents
- **WHEN** user A visits resources, signs out, and user B signs in on the same tab without reloading
- **THEN** B's empty-query palette offers none of A's resources, and A's history is no longer stored in the browser

#### Scenario: A rejected session clears recents too
- **WHEN** the server rejects the current session and the client signs the user out
- **THEN** the recorded history is discarded exactly as on an explicit sign-out
