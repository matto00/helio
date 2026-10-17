## ADDED Requirements

### Requirement: Chart entrance motion uses a token duration and plays once
A chart's entrance animation SHALL run over the standard motion-token duration, set explicitly rather than inherited
from the charting library's default, and SHALL play only when the chart first renders data. A later option or data
change SHALL NOT replay the entrance. Under Motion = Subtle the chart SHALL render without an entrance animation while
keeping its hover-emphasis colour fade; under Off (including OS reduce with no saved choice) it SHALL render with no
animation at all.

#### Scenario: First render animates at the token duration
- **WHEN** a chart panel first renders its data with Motion = Full
- **THEN** its entrance runs over the standard motion duration, not 1000ms

#### Scenario: A data refresh does not replay the entrance
- **WHEN** a mounted chart receives a new option (data refresh or config edit)
- **THEN** the chart updates without replaying its entrance animation

#### Scenario: The entrance is not cut short by an early rebuild
- **WHEN** a new chart's option is rebuilt within its entrance (a theme sync frame or the first size measurement)
- **THEN** the entrance still runs for about the standard motion duration

#### Scenario: Off renders charts statically
- **WHEN** Motion = Off
- **THEN** the chart renders with no entrance animation
