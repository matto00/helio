## Purpose

Exposes the set of pipeline step kinds the product offers for authoring, together with each kind's
backend-declared display group, human description, and whether it is authorable, so that clients render the
add-step surface from server data rather than from their own hardcoded enumeration.

## ADDED Requirements

### Requirement: The step catalog enumerates every registered step kind

An authenticated client SHALL be able to retrieve a step catalog that contains exactly one entry for every
registered step kind — no kind omitted, none duplicated, and no entry for an unregistered kind. The catalog
is derived from the backend's step registry, not from a separately maintained list, so a newly registered
kind SHALL appear in the catalog without any additional edit to the catalog surface itself.

Each entry SHALL carry the kind's stable discriminator string, a display label, a one-line description
written for a user who does not know op names, and whether the kind is authorable (see below). Each entry
SHALL carry its group only when the kind declares one.

#### Scenario: Every registered kind appears exactly once

- **WHEN** an authenticated client retrieves the step catalog
- **THEN** the set of entry discriminators equals the set of registered step kinds exactly, with no
  duplicates

#### Scenario: A newly registered kind appears without editing the catalog surface

- **WHEN** a new step kind is added to the backend step registry and nothing else is changed
- **THEN** the catalog response includes an entry for that kind

#### Scenario: Unauthenticated access is refused

- **WHEN** an unauthenticated caller requests the step catalog
- **THEN** the request is refused with an authentication error and no catalog data is returned

### Requirement: A step kind's group is optional and omitted from the wire when absent

A step kind SHALL be able to declare no group. A missing group SHALL NOT be an error at any layer: not a
compile error, not a validation failure, and not a reason to omit the kind from the catalog. Where a kind
declares no group, the group field SHALL be ABSENT from that entry rather than present-and-null, and clients
SHALL treat an absent group as "ungrouped".

#### Scenario: An ungrouped kind is returned with the group field absent

- **WHEN** a registered kind declares no group and the catalog is retrieved
- **THEN** that kind's entry is present and its group field is absent from the payload entirely — not
  present with a null value, and not substituted with a catch-all group

#### Scenario: A grouped kind carries its declared group

- **WHEN** a registered kind declares a group and the catalog is retrieved
- **THEN** that kind's entry carries exactly that group's identifier

### Requirement: Group display order is server-declared and order-bearing

The catalog SHALL convey the display order of groups as an ordered sequence, so that no client needs its own
ordering table. Any ordering the catalog conveys SHALL be carried in a structure that preserves order
independently of key sorting. Each group SHALL carry an identifier and a display label.

#### Scenario: Groups are conveyed in their declared display order

- **WHEN** the catalog is retrieved
- **THEN** the groups are conveyed as an ordered sequence in the backend's declared display order, and that
  order is stable across requests

#### Scenario: Every group referenced by an entry is described

- **WHEN** an entry declares a group
- **THEN** that group's identifier appears among the catalog's described groups

### Requirement: Authorability is declared by the backend

Each catalog entry SHALL declare whether the kind is authorable — that is, whether a client may offer it as a
choice that a user can successfully create and configure. A kind that is registered and executable but has no
authoring surface SHALL be reported as not authorable rather than being omitted from the catalog. A kind
SHALL be authorable unless it declares otherwise, so that a newly registered kind cannot silently become
unofferable.

#### Scenario: A registered kind with no authoring surface is reported unauthorable

- **WHEN** a kind is registered and executable but the product offers no way to author it
- **THEN** the catalog includes its entry with authorability reported as false

#### Scenario: A kind that declares nothing is authorable

- **WHEN** a kind is registered and does not declare its authorability
- **THEN** the catalog reports it as authorable
