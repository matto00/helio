## ADDED Requirements

### Requirement: Invite codes are single-use, recipient-bound, and stored hashed
The system SHALL persist invite codes in an `invite_codes` table where each row carries a sha256 hash of the
code (plaintext SHALL NOT be persisted), the intended recipient's `user_id`, and a nullable `redeemed_at`
consumption marker. Row-level security SHALL restrict application-context access to rows whose `user_id`
matches the current user. Issuance is manual: a documented owner-side script (run with a BYPASSRLS role)
SHALL generate a code, insert its hash bound to a user resolved by email, and print the plaintext exactly once.

#### Scenario: Issued code is bound to one user and stored as a hash
- **WHEN** the owner issues a code for `user@example.com` via the issuance script
- **THEN** a row exists with that user's id, a sha256 `code_hash`, and `redeemed_at` NULL
- **AND** the plaintext code appears only in the script's one-time output

#### Scenario: Application context cannot read another user's codes
- **WHEN** a query runs under user A's application context against a code intended for user B
- **THEN** row-level security returns no rows

### Requirement: Redeeming a valid code upgrades tier to beta atomically
The system SHALL expose an authenticated `POST /api/beta-access/redeem` endpoint accepting `{ "code": string }`.
For a `free`-tier caller submitting an unredeemed code intended for them, the system SHALL, in a single database
transaction, mark the code redeemed and set the caller's tier to `beta`, then return the updated user object
(including the new tier). Concurrent redemption attempts of the same code SHALL result in at most one success.
A caller whose tier is not `free` SHALL be rejected with `409` before any code is consumed, and the tier update
SHALL be guarded so it can never downgrade a `beta` or `owner` account.

#### Scenario: Valid code upgrades the caller immediately
- **WHEN** a `free` user redeems a valid unredeemed code issued for them
- **THEN** the response returns the user object with `tier = beta`
- **AND** the code's `redeemed_at` is set and the tier change is visible to the very next request

#### Scenario: Concurrent redemption consumes the code once
- **WHEN** two requests race to redeem the same code
- **THEN** at most one succeeds and the other receives the invalid-or-used rejection

### Requirement: Used, invalid, or foreign codes are rejected with a clear error
Redemption with a code that does not exist, was already redeemed, or was issued for a different user SHALL be
rejected with `400` and a clear message. The response SHALL NOT distinguish between these cases (no validity
oracle), and no state SHALL change.

#### Scenario: Already-used code is rejected
- **WHEN** a user redeems a code that has `redeemed_at` set
- **THEN** the response is `400` with a clear invalid-or-used message and the user's tier is unchanged

#### Scenario: Code issued for a different user is rejected
- **WHEN** user A redeems a code issued for user B
- **THEN** the response is `400` with the same message as an unknown code
