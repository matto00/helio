## MODIFIED Requirements

### Requirement: A hung or timed-out CI sbt step captures a JVM thread dump
When a CI sbt invocation exceeds its in-step deadline (or, for the e2e backend start, trips its existing fail-fast
check), CI SHALL capture a thread dump of the JVM that runs the sbt build before stopping anything, and SHALL make it
available as a workflow artifact. The in-step deadline SHALL be shorter than the step's `timeout-minutes`, so capture
happens before the runner kills the step. The whole capture SHALL finish within its stated capture budget (one second
of tolerance in total, not per candidate), however many candidate PIDs there are. The failure message SHALL state
which kind of capture happened: a thread dump file was written, or only SIGQUIT was sent (the dump, if the JVM honoured
it, is in the sbt log), or nothing was dumped.

#### Scenario: sbt goes silent past the deadline
- **WHEN** an sbt invocation produces no completion within its in-step deadline
- **THEN** a thread dump of the sbt build JVM (containing every thread's stack) is written and uploaded as an artifact
- **AND** the step then fails with an error naming the deadline and the artifact
- **AND** the full sbt log is preserved in the job log

#### Scenario: Only SIGQUIT could be sent
- **WHEN** the deadline is exceeded and the dump tool fails for a verified JVM, so only SIGQUIT is sent to it
- **THEN** the failure message says SIGQUIT was sent and the dump, if any, is in the sbt log
- **AND** it does NOT say a thread dump was captured

#### Scenario: Many candidates within the budget
- **WHEN** the capture has several candidate PIDs and a small capture budget
- **THEN** the capture finishes no more than one second after the budget, and candidates it had no budget left for are
  reported as skipped rather than worked on

#### Scenario: Healthy run
- **WHEN** an sbt invocation completes within its deadline
- **THEN** no diagnostics are captured, the step's outcome is sbt's own exit status, and its duration is not
  materially longer than before the change

### Requirement: Diagnostic and cleanup PIDs come from recorded sources only
The JVM to dump, and any process stopped after a timeout, SHALL be identified only from a recorded source: the PID or
process group recorded when CI launched sbt. CI SHALL launch sbt only in the single-foreground-JVM (`--server`) mode, so
no sbt server outside the recorded group exists to be found. A PID SHALL be verified (it is a live JVM whose working
directory is the backend build) before it is dumped or signalled. Process-name or command-line pattern matching
(`pgrep`, `pkill`, `killall`, `pidof`, `ps | grep` and equivalents) SHALL NOT be used.

#### Scenario: The recorded PID is not a matching JVM
- **WHEN** the recorded PID is dead or is not a JVM running in the backend build directory
- **THEN** no dump is attempted against it and no signal is sent to that PID individually, and the failure message
  says so
- **AND** the process group recorded at launch is still stopped, so nothing CI launched outlives the step

#### Scenario: Static guard
- **WHEN** the CI checks run on a pull request
- **THEN** they fail if a CI sbt helper script contains a pattern-matching process lookup or kill, including one
  written across several physical lines joined by shell line continuations or a trailing pipe

#### Scenario: Recorded PID is the build JVM
- **WHEN** CI launches sbt through the helper
- **THEN** the PID it records is the sbt build JVM itself, not a pipe, tee or wrapper process

#### Scenario: No thin-client mode remains
- **WHEN** a CI sbt helper is asked for a client/thin-client mode
- **THEN** it rejects the request (or offers no such option) rather than launching sbtn
