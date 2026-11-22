## ADDED Requirements

### Requirement: The 1440 pipeline-detail cell measures the spine card's sample-refresh control
The state-surface contrast guard's 1440 px pipeline-detail cell SHALL wait until the spine card's source-sample
refresh button is visible and enabled before it records the cell's interactive elements, and SHALL fail, naming the
button, if that button was not among the elements whose hover and focus states the cell measured.

#### Scenario: A reintroduced invisible hover on the spine card fails at 1440
- **WHEN** the spine card's source-sample refresh button hover is reverted to the shared ghost hover that measured
  1.03:1 against the card in dark theme
- **THEN** the 1440 px pipeline-detail cell fails in dark theme, naming that button and its ratio

#### Scenario: The unmutated application passes at 1440
- **WHEN** the guard runs against the application as merged
- **THEN** the 1440 px pipeline-detail cell passes in both themes, having measured the refresh button

#### Scenario: A refresh button that was not measured fails loudly
- **WHEN** the 1440 px pipeline-detail cell finishes without the refresh button among its measured elements
- **THEN** the cell fails, naming the button

### Requirement: Each narrow part of the guard selects its widths by value
A narrow-width part of the state-surface contrast guard SHALL select the widths it covers by width value, and SHALL
fail if a width it names is not in the guard's width matrix.

#### Scenario: A named width missing from the matrix fails
- **WHEN** a narrow part names a width that is not in the guard's width matrix
- **THEN** listing or running that part fails, naming the width

#### Scenario: Reordering the width matrix does not change a part's coverage
- **WHEN** the guard's narrow width matrix is reordered
- **THEN** each narrow part file still runs exactly the widths it names
