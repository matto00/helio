## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **The three target literals exist exactly where the artifacts claim.**
  `grep -n "example.com" src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala`
  → `939: seedCsvUrlDs("https://example.com/data.csv")`, `972:` and `1014:
  seedTextUrlDs("https://example.com/notes.txt")`. Exactly three hits, exactly
  the lines named in ticket.md / tasks.md 1.1-1.2. Task 1.4 ("zero remaining
  hits") is therefore satisfiable by construction.
- **The refuted premise holds up under my own read (I did not take the
  premise-validation doc's word).** `PipelineRunServiceSpec.scala:134-139`
  constructs `new PipelineRunService(...)` with no `system` argument;
  `PipelineRunService.scala:59` declares `system: ActorSystem[_] = null`;
  `urlFetchSeam` at `:90-92` returns
  `Future.successful(Left("URL-backed source fetch is not configured"))` when
  `system == null`, ahead of every `CsvUrlFetch.fetch` /
  `ContentSourceSupport.fetchUrlWithLimit` branch at `:96-100`. The main-source
  comment at `:55-58` independently documents the same null-fixture contract.
  The URL string is inert.
- **The cited convention is real, not invented.**
  `PipelineRunRoutesSpec.scala:199-200` → `https://pipeline-run-routes.test/ok`
  and `/fail`; `InProcessPipelineEngineSpec.scala:52-53` →
  `https://rest-engine.test/ok` and `/fail`. D1's proposed
  `pipeline-run-service.test` matches the sibling `<spec-name>.test` shape.
- **No placeholders.** Grep for `TODO|TBD|figure out later` across the change
  dir: zero hits.
- **`skip_specs: true` is actually set**, as proposal.md claims —
  `openspec/changes/misleading-test-url-literals/.openspec.yaml`. The proposal's
  refusal to invent a requirement to satisfy validation is the correct call for
  a fixture-literal change.
- **AC coverage traced, no orphans, no drift.** AC1→task 1.1/1.2; AC2 (no
  assertion changed)→1.3; AC3 (no local server)→honored as a non-goal in
  proposal.md and design.md, no task contradicts it; AC4 (durable grep
  sweep)→1.6; AC5 (`sbt test`)→1.5. No task exceeds the ACs.
- **D2 (third literal) checked for scope drift, and it is not drift.** Line 939
  carries the identical literal for the identical reason as 972/1014; changing
  two of three would leave the exact hazard the change exists to remove. Same
  file, same statement kind, no new blast radius.
- **Internal consistency:** ticket.md, proposal.md, design.md and tasks.md agree
  on the host, the paths (`/data.csv`, `/notes.txt` kept per D3), the file, and
  the non-goals. I found no contradiction between them.

### Verdict: CONFIRM

Sound enough to implement. The plan is proportionate to a three-literal change,
its factual claims survive independent verification against the source, and it
correctly declines both the refuted network fix and the owner-excluded local
server.

### Non-blocking notes

- 20+ other backend specs still contain `example.com` literals (e.g.
  `DataSourceProtocolSpec`, `ApiRoutesSpec`, `MfaApiRoutesSpec`). The premise
  validation classifies these as inert string/serialization assertions, and
  keeping this change to the one misleading fixture is the right scope — but if
  a tree-wide `.test` normalization is ever wanted, it belongs in its own
  ticket, not here.
- Task 1.6 asks the executor to restate the grep sweep for the PR body. Worth
  pasting the sweep's actual classification (per-file), not just the negative
  conclusion, so AC4's durability claim is evidence rather than assertion.
