## ADDED Requirements

### Requirement: History baselines are unaffected by thinning
Because history thinning never removes an Output's newest 101 points and `rolling_avg` accepts `n` of at most 100,
`baseline = "previous"` SHALL resolve to the immediately previous recorded run and `baseline = "rolling_avg"` SHALL
average exactly the `n` most recent recorded runs (both excluding the triggering run), whether or not a retention pass
has run since those points were written. Points older than the pipeline owner's tier maximum age are still purged and
can never contribute.

#### Scenario: Rolling average after a retention pass at one-minute cadence
- **WHEN** an Output recorded runs one minute apart, a retention pass has thinned its history, and a
  `rolling_avg` rule with `n = 100` is evaluated for a new run
- **THEN** the baseline is the mean of the 100 runs recorded immediately before the triggering run, identical to the
  value before the retention pass

#### Scenario: Previous after a retention pass
- **WHEN** the same Output's `previous` rule is evaluated after the retention pass
- **THEN** the baseline is the run recorded immediately before the triggering run
