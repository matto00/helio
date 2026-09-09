## Purpose
Defines the mechanical guarantee that an interactive state's background differs measurably from the surface it renders on, in every theme — the contrast rule and its threshold, the requirement that the checked population be derived from the tree rather than hand-listed, and the guard's own continuously-demonstrated failability.

## ADDED Requirements

### Requirement: A state background must differ measurably from its parent surface in every theme
A check SHALL fail when an interactive state background (hover, active, selected, or focus) does not differ from the surface it renders on by at least a defined contrast threshold, evaluated independently for **every** theme the stylesheet set defines. Inequality of token names or of resolved values SHALL NOT satisfy this requirement: two distinct values that are perceptually indistinguishable SHALL fail. The failure output SHALL name the offending state, the parent surface, the theme, and the measured value.

This class fails open at runtime — the state renders, tracks correctly, and reports correct computed styles while conveying nothing to the user — so no test of behavior and no comparison of token names can detect it.

#### Scenario: A state identical to its parent surface fails
- **WHEN** a state background resolves to the same value as the surface it renders on in some theme
- **THEN** the check fails and names that state, that surface, and that theme

#### Scenario: A state distinct from but indistinguishable from its parent surface fails
- **WHEN** a state background resolves to a value different from its parent surface but below the contrast threshold in some theme
- **THEN** the check fails, and the difference in values alone does not exempt it

#### Scenario: A state with real contrast against its parent surface passes
- **WHEN** a state background differs from its parent surface by at least the threshold in every theme
- **THEN** the check passes

#### Scenario: A state passing in one theme and failing in another fails
- **WHEN** a state clears the threshold in one theme but not in another
- **THEN** the check fails and names the theme in which it failed

### Requirement: The checked population must be derived from the rendered application
The set of state/surface pairs the check evaluates SHALL be derived by inspecting the **rendered application** — enumerating interactive elements from the rendered document and resolving each one's parent surface from the rendered ancestry — and SHALL NOT be read from a hand-maintained inventory of components or files. A population curated by hand offers no guarantee about anything absent from the list and cannot detect a newly added component at all.

Derivation from the rendered application rather than from stylesheet text is required, not incidental: the surface a state composites against is frequently supplied by an ancestor rather than by the element's own rule, and that relationship is established by the cascade and the document structure, neither of which exists in the stylesheet text alone.

The check's coverage SHALL be reported with its results, and the reported scope SHALL name the parts of the application that were visited, so that the coverage claim is legible rather than implied. A state on a part of the application the check does not visit is outside the reported scope and SHALL NOT be described as checked.

#### Scenario: A newly added state is checked without any inventory being edited
- **WHEN** a visited part of the application gains a new interactive state background and no inventory file is updated
- **THEN** that new state is included in the checked population

#### Scenario: A state whose surface comes from an ancestor is checked against that ancestor
- **WHEN** an element's own background is absent or not fully opaque
- **THEN** its parent surface is resolved from the rendered ancestry, and the state is evaluated against the surface it actually composites against

#### Scenario: Coverage scope is reported alongside the result
- **WHEN** the check reports a result
- **THEN** it reports which parts of the application were visited and how many states were evaluated

#### Scenario: The threshold is justified against measured values
- **WHEN** the threshold is defined
- **THEN** it separates the known-broken pairs from the known-good remediation, and that separation is recorded

### Requirement: A state background is evaluated on the colour that is actually painted
Where a state background or any resolved parent surface is not fully opaque, the check SHALL composite it over its backdrop and evaluate the contrast between the resulting **opaque** colours. A partially transparent ancestor SHALL contribute to the backdrop rather than terminating the search for one.

A computed background colour carries its own alpha. Comparing a translucent state against a surface as though it were opaque overstates the difference between them, so a state that is in fact indistinguishable can pass — a silent false pass, in the direction that hides the defect.

#### Scenario: A translucent state is evaluated on its composited value
- **WHEN** a state background is not fully opaque
- **THEN** the check evaluates the colour resulting from compositing it over its backdrop, not its declared value

#### Scenario: A translucent state that is indistinguishable once composited fails
- **WHEN** a translucent state would clear the threshold if compared uncomposited, but falls below it once composited over its backdrop
- **THEN** the check fails

### Requirement: The guard's failability is demonstrated continuously
A self-test SHALL accompany the check and SHALL re-prove on every run that the check goes red for the broken condition, by driving known-broken pairs — including the real values this defect was found at — through it. Each case SHALL assert on the **pair named in the check's output**, never on exit code or error count alone, so that a check pointed at an unrelated corpus cannot appear to pass its own self-test.

A guard proven failable once, by hand at review time, can silently stop being failable through a later refactor.

#### Scenario: The self-test proves the real broken values go red
- **WHEN** the self-test runs
- **THEN** it drives the real broken pairs through the check and asserts the check names them

#### Scenario: A guard that stopped detecting the class fails its own self-test
- **WHEN** the check is altered so that it no longer reports a known-broken pair
- **THEN** the self-test fails

### Requirement: A state that conveys nothing is detected
The check SHALL compare each interactive element before and during its state and SHALL fail when the element's appearance does not change at all. Where the element conveys its state by a means other than its background — a border, an outline, or a shadow — the check SHALL report the state without failing, because choosing between those means is a design decision rather than a defect.

The absence of any state expression is the form of this defect that leaves no trace to search for: a component that conveys nothing looks, in its source, exactly like a component that was never meant to convey anything.

#### Scenario: An element with no state expression fails
- **WHEN** an interactive element's appearance is unchanged during its state
- **THEN** the check fails and names that element

#### Scenario: An element expressing state without a background change is reported, not failed
- **WHEN** an interactive element's background is unchanged during its state but its border, outline, or shadow changes
- **THEN** the check reports the state and does not fail
