## MODIFIED Requirements

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
- **AND** a trailing pipe, `&&` or `||` followed by one or more blank or whitespace-only lines before the next command
  is still treated as one pipeline, as bash treats it

#### Scenario: Recorded PID is the build JVM
- **WHEN** CI launches sbt through the helper
- **THEN** the PID it records is the sbt build JVM itself, not a pipe, tee or wrapper process

#### Scenario: No thin-client mode remains
- **WHEN** a CI sbt helper is asked for a client/thin-client mode
- **THEN** it rejects the request (or offers no such option) rather than launching sbtn
