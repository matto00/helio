## MODIFIED Requirements

### Requirement: applyFilter supports equality and inequality operators
The filter step SHALL support operators `=` and `!=`.

When the row's value for the referenced field is a numeric value and the condition value parses as a
number, the comparison SHALL be numeric, so that a stored number matches any condition value denoting
the same number regardless of how either side is textually written (`0`, `0.0`, `00`, `0e0`).

When the row's value is not numeric — including a string that happens to look like a number — the
comparison SHALL be an exact string comparison of the row value's textual form against the condition
value. A string-typed row value SHALL NOT be numerically coerced.

When the condition value does not parse as a number, the comparison SHALL be an exact string
comparison, whatever the row value's type.

A null (or absent) row value SHALL never satisfy `=`, and SHALL always satisfy `!=`, for any condition
value. `!=` SHALL be the exact negation of `=` for every non-null row value.

#### Scenario: = operator keeps matching rows
- **WHEN** a condition is `{"field":"dept","operator":"=","value":"eng"}`
- **THEN** only rows where `dept` equals `"eng"` are returned

#### Scenario: != operator excludes matching rows
- **WHEN** a condition is `{"field":"dept","operator":"!=","value":"eng"}`
- **THEN** rows where `dept` equals `"eng"` are excluded

#### Scenario: = matches a numeric row value written differently in the condition
- **WHEN** a row's `years_exp` is the number `0` and a condition is `{"field":"years_exp","operator":"=","value":"0"}`
- **THEN** that row is returned

#### Scenario: = still matches when the condition value carries a decimal point
- **WHEN** a row's `years_exp` is the number `0` and a condition is `{"field":"years_exp","operator":"=","value":"0.0"}`
- **THEN** that row is returned

#### Scenario: = does not match a different number
- **WHEN** a row's `years_exp` is the number `3` and a condition is `{"field":"years_exp","operator":"=","value":"0"}`
- **THEN** that row is excluded

#### Scenario: = on a non-numeric string column keeps string semantics
- **WHEN** a row's `position` is the string `"WR"` and a condition is `{"field":"position","operator":"=","value":"WR"}`
- **THEN** that row is returned

#### Scenario: A numeric-looking string column is compared as a string, not a number
- **WHEN** a row's `player_id` is the string `"007"` and a condition is `{"field":"player_id","operator":"=","value":"7"}`
- **THEN** that row is excluded

#### Scenario: A numeric-looking string column still matches its exact textual value
- **WHEN** a row's `player_id` is the string `"007"` and a condition is `{"field":"player_id","operator":"=","value":"007"}`
- **THEN** that row is returned

#### Scenario: A non-numeric condition value against a numeric row value does not match
- **WHEN** a row's `years_exp` is the number `0` and a condition is `{"field":"years_exp","operator":"=","value":"zero"}`
- **THEN** that row is excluded

#### Scenario: != excludes rows the numeric comparison matches
- **WHEN** a row's `years_exp` is the number `0` and a condition is `{"field":"years_exp","operator":"!=","value":"0"}`
- **THEN** that row is excluded

#### Scenario: != keeps rows whose numeric value differs
- **WHEN** a row's `years_exp` is the number `3` and a condition is `{"field":"years_exp","operator":"!=","value":"0"}`
- **THEN** that row is returned

#### Scenario: A null row value never satisfies =
- **WHEN** a row's `years_exp` is null or absent and a condition is `{"field":"years_exp","operator":"=","value":"0"}`
- **THEN** that row is excluded

#### Scenario: A null row value always satisfies !=
- **WHEN** a row's `years_exp` is null or absent and a condition is `{"field":"years_exp","operator":"!=","value":"0"}`
- **THEN** that row is returned

### Requirement: applyFilter supports contains operator for substring matching
The `contains` operator SHALL check whether the string representation of the field value
contains the condition value as a substring. The check SHALL be case-sensitive. `contains` is a
textual operator by definition and SHALL NOT numerically coerce either side; a numeric row value is
matched against its textual form.

#### Scenario: contains keeps rows where field contains substring
- **WHEN** a condition is `{"field":"name","operator":"contains","value":"ali"}`
- **THEN** only rows where the string value of `name` contains `"ali"` are returned

#### Scenario: contains is not numerically coerced
- **WHEN** a row's `years_exp` is the number `10` and a condition is `{"field":"years_exp","operator":"contains","value":"1"}`
- **THEN** that row is returned, because the textual form contains `"1"`
