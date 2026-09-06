## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round-2 CR3 (URI construction form) — factually SOUND.** I ran the multi-arg
`java.net.URI(scheme,userInfo,host,port,path,query,fragment)` constructor directly under
`java` and reproduced every behaviour the design asserts:

```
host=[::1]                 uri=https://[::1]                getHost=[::1]
host=[evil.test/@internal] uri=https://evil.test/@internal   getHost=evil.test
host=[host,other]          EX URISyntaxException: Illegal character in hostname
host=[evil.test:5432]      EX URISyntaxException: Malformed IPv6 address
singlearg https://::1      getHost=null
```

So the multi-arg choice, the round-trip identity requirement, and the withdrawal of round-1's
false "the constructor rejects it" claim are all correct. Decision 1's charset gate + round-trip
pair is a sound design. (See CR3 below for the structural problem that remains.)

**Round-2 CR1 (the seam) — the replacement claim is FALSE. Reproduced twice with scalac 2.13.15**
(the project's `scalaVersion`, `backend/build.sbt:1`). Design Decision 4a item 1 and task 2a.1
both assert that adding defaulted `resolveHost`/`isBlocked` parameters to the `ConnectorDriver`
trait methods is "source-compatible for every existing call site and **every other
`ConnectorDriver` implementation** — nothing else has to change to keep compiling." Minimal repro:

```scala
trait D[C] { def fetch(c: C, maxRows: Int, rc: String, isBlocked: String => Boolean = _ => false): Int }
object Impl extends D[String] { def fetch(c: String, maxRows: Int, rc: String): Int = 1 }
```

```
T.scala:4: error: object creation impossible.
Missing implementation for member of trait D:
  def fetch(c: String, maxRows: Int, rc: String, isBlocked: String => Boolean): Int = ???
```

Default arguments help **callers**, not **implementers**: an existing override no longer matches
the widened signature and stops implementing the abstract member. I confirmed the caller half is
fine with a second compile (`Impl.fetch("a",1,"b")` and the same through a `D[String]`-typed
reference both compile once the implementation is widened), so the claim is half true and half
false in exactly the direction that matters.

Implementations that will break (`grep` for `extends ConnectorDriver`):
`RestApiConnectorDriver.scala:58`, `NewConnectorInferenceSpec.scala:25` (`RowSupplyingConnector`),
`ConnectorSpec.scala:19` (`FixtureConnector`), `CreateSourceEnvelopeSpec.scala:30`
(`EnvelopeFixtureConnector`).

**Seam reach — new defect found this round.** I read the call chain rather than the narrative.
`SourceService` does not call the driver directly on the create or test-connection paths: it
goes through two *generic* intermediaries that Decision 4a's four-item seam list does not
mention — `CreateSourceEnvelope.build[Config](connector, ...)` (`SourceService.scala:65`; it
calls `connector.inferSchema(config, ...)` at `CreateSourceEnvelope.scala:39`) and
`ConnectionTest.run[Config](connector, ...)` (`SourceService.scala:220`;
`ConnectionTest.scala:22`). Neither takes `resolveHost`/`isBlocked`.

**`checkEgress` has no extractable "core".** I read
`ContentSourceSupport.scala:184-213`: `checkEgress` is one monolithic function that parses its
`url: String` argument with the **single-arg** `new URI(url)` and resolves `uri.getHost`. There
is no host-level core to delegate to today.

**Decision 4b (no SQL update path)** re-checked: the only non-create `SqlSource` mutation I find
is the rename path, consistent with the design; the executor is correctly told to re-derive it.
No objection.

**Decision 2/3/4/5** re-read afresh. Connect-time-as-the-boundary, `Unresolvable` fatal at
connect and tolerated at create, the unpinned-with-residual-risk election under AC3, and the
red-then-green + mutation-check test strategy are all sound and I raise nothing new against them.

### Verdict: REFUTE

### Change Requests

1. **Withdraw the false source-compatibility claim and enumerate the implementations that must
   change.** Design Decision 4a item 1 and tasks.md 2a.1 both state that widening the
   `ConnectorDriver` trait methods keeps "every other implementation" compiling. Compiled proof
   above shows the opposite: every implementation stops overriding the abstract member and fails
   with "object creation impossible". Correct the wording to "source-compatible for every
   existing **call site**; every **implementation** must be widened to match", and add an explicit
   task listing the four sites — `RestApiConnectorDriver.scala:58`,
   `NewConnectorInferenceSpec.scala:25`, `ConnectorSpec.scala:19`,
   `CreateSourceEnvelopeSpec.scala:30` — as required edits. This matters beyond documentation:
   the design tells the executor nothing else has to change, and the first thing that happens is
   a compile failure in shared SPI code, which is precisely the pressure Decision 4a says
   produces the forbidden global. Note also that `ConnectorSpec.scala` carries a deliberate
   compile-time trait-dispatch proof, so widening the SPI is a change to a tested contract and
   should be acknowledged as such rather than treated as incidental.

2. **Close the seam gap through the two generic intermediaries.** Decision 4a items 2–4 and tasks
   2a.1/2a.1a/2a.2 name the driver methods, `SourceService`'s constructor and
   `InProcessPipelineEngine`'s constructor, but the create path and the test-connection path do
   not reach the driver from `SourceService` directly — they pass through
   `CreateSourceEnvelope.build` (`SourceService.scala:65` → `CreateSourceEnvelope.scala:39`) and
   `ConnectionTest.run` (`SourceService.scala:220` → `ConnectionTest.scala:22`), neither of which
   accepts an override. As specified, a `SourceService`-level `isBlocked` override cannot reach
   the `inferSchema` that actually opens the JDBC connection on create, which breaks both task
   6.2 (AC4's end-to-end "legitimate host still works" proof, if routed through create) and task
   8.1b's promise that every affected spec is repairable via the task-2a seam. Add these two
   helpers to the seam explicitly with defaulted parameters, or state the alternative route and
   why it suffices.

3. **Resolve the contradiction between "delegate to `checkEgress`" and the round-2 CR3 pin.**
   Decision 1 requires that the string handed to `resolveHost` be the **caller-supplied `host`,
   not `uri.getHost`**, and that construction use the multi-arg `URI` constructor — while the
   same decision and task 1.1 say `checkEgressHost` "synthesises an `https` authority and
   delegates to the existing `checkEgress` core". Read against
   `ContentSourceSupport.scala:184-213`, no such core exists: `checkEgress` takes a `String`,
   re-parses it with the **single-arg** `new URI(url)`, and passes its own `uri.getHost` to
   `resolveHost`. Delegating therefore cannot honour the pin, and the only two ways out —
   reimplementing the resolve/exists-blocked loop inside `checkEgressHost`, or refactoring
   `checkEgress` — are respectively a forbidden second policy and a change the proposal currently
   describes as purely "additive". Pin the structure: state that `checkEgress(url, ...)` is
   refactored to parse-then-delegate into a new host-level `checkEgressHost(host, ...)` that owns
   the single `resolveHost`/`isBlocked` loop, and update proposal.md's Impact line so the
   `ContentSourceSupport` edit is not described as additive-only. Call out the bracket detail
   while you are there (`::1` vs `[::1]`) so the injected test resolvers key on the same string
   the guard resolves.

### Non-blocking notes

- `PipelineService.scala:1525` (`SqlConnectorDriver.inferSchema` on the inline-proposal path) is
  listed in Decision 4a as a call site broken by the trait change but is assigned no seam. It
  probably needs none (production defaults are correct there), but say so explicitly so the
  executor does not read the omission as an oversight and invent one.
- Decision 5.3's IPv6 ULA case names no concrete address where every other class gets one; pick
  one (e.g. `fd00::1`) so the executor is not choosing security-test data freehand.
