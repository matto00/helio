# resource-navigation Specification

## Purpose
Provides a single way to say "take the user to this resource" and to produce a link for it, so that any surface offering navigation to a dashboard, data source, data pipeline or output does so identically — including kinds whose location is not expressed in the address bar, and kinds that live inside another resource.

## Requirements

### Requirement: A navigable resource whose location needs more than an identifier is expressible
The navigable-resource reference SHALL be able to express a resource that cannot be located by its own
identifier alone — in particular one that lives within another resource and is opened as a sub-view of it.
Producing a link for such a resource SHALL yield a real address that opens the resource directly, so that a
consumer may offer it as an ordinary link rather than an action.

#### Scenario: A nested resource is navigable
- **WHEN** a consumer asks to navigate to a resource that lives inside another resource
- **THEN** the application opens the containing resource with that nested resource presented

#### Scenario: A nested resource yields a real address
- **WHEN** a consumer requests a link for such a resource
- **THEN** it receives an address that, opened directly, presents that nested resource — not merely its
  container

#### Scenario: Existing kinds are unaffected
- **WHEN** a consumer navigates to a resource kind that was already supported
- **THEN** it behaves exactly as it did before the reference was widened
