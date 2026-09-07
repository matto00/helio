# connectors/connector-completion-token Specification

## Purpose
Defines the completion token that lets a human supply a Connector's credential out-of-band — its
generation, single-use and expiry contract, its non-disclosure and indistinguishability guarantees, and the
protected write the supplied credential must travel through.. Update Purpose after archive.

## Requirements

### Requirement: Completion tokens are cryptographically unguessable

The system SHALL generate every Connector completion token from a cryptographically secure pseudorandom
number generator with at least 128 bits of entropy. The system SHALL NOT derive a token from the Connector
identifier, the owner identifier, a timestamp, a counter, or any other predictable or caller-observable
input.

#### Scenario: Generated tokens are unpredictable
- **WHEN** two completion tokens are minted in immediate succession
- **THEN** neither is derivable from the other, from its Connector's identifier, or from the creation time
- **AND** each carries at least 128 bits of entropy

#### Scenario: Tokens are drawn from a secure generator
- **WHEN** a completion token is minted
- **THEN** its randomness originates from a cryptographically secure generator, not a general-purpose PRNG

### Requirement: A completion token authorizes credential submission only while valid

A completion token SHALL be considered valid if and only if it exists, has not been consumed, has not been
superseded by a later mint for the same Connector, and its expiry is strictly in the future relative to the time of the request. A valid token SHALL authorize supplying a
credential for exactly the one pending Connector it was minted for, and nothing else. An invalid token SHALL
authorize nothing. A completion token SHALL always carry an expiry; an unbounded completion token SHALL NOT
be representable.

#### Scenario: A valid token authorizes completion of its own Connector
- **WHEN** a caller presents an unconsumed, unexpired token
- **THEN** the caller may supply a credential for that token's Connector

#### Scenario: An expired token authorizes nothing
- **WHEN** a caller presents a token whose expiry is at or before the current time
- **THEN** no credential is accepted and the Connector remains pending

#### Scenario: Expiry boundary is exclusive
- **WHEN** a token's expiry is exactly equal to the current time
- **THEN** the token is treated as expired

#### Scenario: An authenticated non-owner cannot complete
- **WHEN** a completion request carries an authenticated session belonging to a user who does not own the
  token's Connector
- **THEN** the request is refused and no credential is bound

#### Scenario: An unauthenticated completion is permitted
- **WHEN** a completion request carries a valid token and no authenticated session
- **THEN** the credential is accepted, because out-of-band completion by a human who is not signed in is the
  purpose of the handoff

#### Scenario: A token cannot complete a different Connector
- **WHEN** a caller presents a valid token together with a different Connector's identifier
- **THEN** the request is refused and neither Connector is modified

### Requirement: A completion token is single-use

The system SHALL consume a completion token when it is successfully used to bind a credential, and SHALL
reject every subsequent presentation of that token. A pending Connector SHALL NOT remain an open slot after
completion.

#### Scenario: Replay after successful completion is rejected
- **WHEN** a token has been used to bind a credential and the same token is presented again
- **THEN** the request is refused with no grace period
- **AND** the already-bound credential is not replaced

#### Scenario: A failed submission does not consume the token
- **WHEN** a submission is rejected because the supplied credential is empty or otherwise invalid
- **THEN** the token remains usable until it expires

### Requirement: An expired completion token is recoverable by re-minting

An expired or consumed completion token SHALL NOT permanently strand its pending Connector. The system
SHALL allow a fresh token to be minted for a Connector that is still pending, both when the agent
re-initiates a Connector matching an existing pending one and when its authenticated owner requests it.
Minting a new token SHALL invalidate any previously outstanding token for that Connector, so that at most
one token is live for a pending Connector at any time. Re-initiation SHALL NOT create a duplicate pending
Connector.

#### Scenario: A human arriving after expiry can still complete the Connector
- **WHEN** a completion token has expired and a fresh token is minted for the still-pending Connector
- **THEN** the new token completes the Connector normally
- **AND** the Connector was never permanently unusable

#### Scenario: Re-initiation does not accumulate pending Connectors
- **WHEN** an agent initiates a Connector for an owner, kind and base URL that already has a pending
  Connector
- **THEN** a fresh token is minted against the existing pending Connector
- **AND** no duplicate pending Connector is created

#### Scenario: Minting a new token invalidates the previous one
- **WHEN** a second token is minted for a pending Connector while an earlier token is still unexpired
- **THEN** the earlier token no longer authorizes completion
- **AND** the earlier token's rejection is indistinguishable from that of an expired or unknown token

#### Scenario: Minting and superseding are atomic
- **WHEN** a new token is minted for a pending Connector that already has a live token
- **THEN** at no observable point are two tokens live for that Connector, nor zero

#### Scenario: An owner may mint a replacement for a Connector they own
- **WHEN** an authenticated owner requests a new completion token for their own pending Connector
- **THEN** a new token is returned in that response only, together with its expiry
- **AND** a caller who does not own the Connector, or whose Connector is not pending, is refused

#### Scenario: Re-initiation with a different auth shape does not reuse the row
- **WHEN** an agent initiates a Connector matching an existing pending one on owner, kind and normalized
  base URL but naming a different intended auth shape
- **THEN** a separate pending Connector is created rather than re-minting onto the existing row
- **AND** the human is never presented a form for a credential type the agent did not request

### Requirement: Invalid completion tokens are indistinguishable from one another

The system SHALL respond identically to an expired token, a consumed token, a **superseded** token, and a
token that has never existed. The response status, the response body, and any other caller-observable signal SHALL NOT differ
between these cases, because any observable difference turns the endpoint into an existence oracle for
another owner's pending Connectors. Validation SHALL NOT introduce an additional query, branch, or
round-trip on any one failure path relative to the others.

#### Scenario: Consumed, superseded and nonexistent tokens are identical to the caller
- **WHEN** a caller presents a consumed token, separately a superseded token, and separately a token that
  has never existed
- **THEN** all three responses carry the same status code and the same body
- **AND** none reveals whether the token or its Connector exists

#### Scenario: The owner, unlike an anonymous caller, can see that completion happened
- **WHEN** a Connector has been completed through the handoff path and its authenticated owner reads their
  Connector list or requests a replacement completion token
- **THEN** the owner observes that the Connector was completed, and when
- **AND** the anonymous completion endpoint's responses are unchanged and remain identical across every
  failure mode

#### Scenario: Expired and nonexistent tokens are identical to the caller
- **WHEN** a caller presents an expired token, and separately a token that has never existed
- **THEN** both responses carry the same status code and the same body

#### Scenario: No failure path costs more than another
- **WHEN** a token is rejected as unknown, as consumed, or as expired
- **THEN** each rejection takes the same single lookup, with the remaining state checks performed in memory

### Requirement: A completion token's secret is disclosed only at mint time

The system SHALL return a completion token's secret value only in the response that mints it. No subsequent
read, list, or status path SHALL return the secret value, and the secret SHALL NOT appear in logs or error
messages.

#### Scenario: Reading a pending Connector does not reveal its completion token
- **WHEN** a pending Connector is read after its token was minted
- **THEN** the response identifies the Connector and its pending status
- **AND** the response does not carry the completion token's secret value

#### Scenario: Rejections do not echo the presented token
- **WHEN** a completion request is refused for any reason
- **THEN** the response body and the emitted logs do not contain the presented token value

### Requirement: Credential submission through the completion path uses the existing protected write

A credential supplied through the completion path SHALL be persisted only through the same
envelope-encrypted write used by every other Connector credential, and SHALL fail closed if encryption
cannot be performed. The completion path SHALL NOT introduce an alternative persistence route.

#### Scenario: A completed credential is encrypted at rest
- **WHEN** a human supplies a credential through a valid completion token
- **THEN** the value is persisted only in envelope-encrypted form under the active key identifier
- **AND** the plaintext is not persisted anywhere

#### Scenario: Encryption failure leaves the Connector pending
- **WHEN** the encryption step fails during completion
- **THEN** the request is refused, no credential is stored, and the Connector remains pending
- **AND** the token is not consumed
