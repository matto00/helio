## MODIFIED Requirements

### Requirement: Assert config decode tolerates partial or legacy data without throwing
`AssertConfig.decode` SHALL NOT throw for a config missing the `rules` key entirely (defaulting to an
empty rule vector), for a rule entry omitting `field`, `params` or `severity` (each defaulting rather
than causing the entry, or the whole config, to be rejected), and for any contents of a rule's `params`
object, whose shape is deliberately open and rule-kind-specific.

`AssertConfig.decode` SHALL, however, fail for a key that is **present but whose JSON type cannot
represent the declared shape** — a `rules` value that is not an array, a `rules` element that is not an
object, or a `params` value that is not an object. Such a value SHALL NOT default.

This narrows an earlier guarantee that decode would not throw for *any* input, including malformed
fields. The narrowing is deliberate and is the same one applied to every other step kind: a rule entry
silently replaced by defaults, or an entry silently dropped from the rules vector, produces an assert
step that reports success while checking something other than what was configured — which is the
failure mode this capability exists to prevent. Absence and open `params` contents remain tolerated,
because those are legitimate partial and rule-kind-specific states; only a value whose JSON type is
wrong now fails.

#### Scenario: Missing rules key decodes to an empty rule vector
- **WHEN** `AssertConfig.decode` is called with `{}`
- **THEN** the decoded config has an empty `rules` vector

#### Scenario: A malformed rule entry does not throw
- **WHEN** `AssertConfig.decode` is called with `{"rules": [{"kind": "notNull"}]}` (missing `field`,
  `params`, `severity`)
- **THEN** decode succeeds without throwing, producing a rule with `kind: "notNull"` and default values
  for the missing fields

#### Scenario: A rules value of the wrong JSON type fails to decode
- **WHEN** `AssertConfig.decode` is called with `{"rules": "notNull"}`
- **THEN** decode fails rather than producing an empty rule vector

#### Scenario: A rules element of the wrong JSON type fails to decode
- **WHEN** `AssertConfig.decode` is called with `{"rules": ["not-an-object", 42, null]}`
- **THEN** decode fails rather than producing three all-default rules

#### Scenario: Open params contents remain tolerated
- **WHEN** `AssertConfig.decode` is called with a rule whose `params` object holds keys and value types
  that no rule kind recognises
- **THEN** decode succeeds, because `params` contents are deliberately open
