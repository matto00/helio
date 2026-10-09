## Standing Constraints

## 1. Backend

- [x] 1.1 Dashboard example: output panel keeps only title/type/outputId (drop fieldMapping/aggregation/label/unit)
- [x] 1.2 Combined example: panel keeps only title/type/outputId; add cast step s1 (signups→integer); Output = metric on s1 with fieldMapping.value + aggregation {agg: sum}
- [x] 1.3 PatchSetExample summary matches its patch (no "unit")
- [x] 1.4 PipelineService.validateOutputFieldMapping: split the long chained line, no behaviour change

## 2. Frontend

- [x] 2.1 buildAggregateTailConfigs chart branch writes fieldMapping { xAxis: groupBy, yAxis: alias }

## 3. Docs

- [x] 3.1 Remodel design doc: dated correction notes at decision 2 (L31), L72, L152 on Output-level aggregation

## 4. Tests

- [x] 4.1 Frontend red-first test: chart tail fieldMapping equals {xAxis, yAxis}, keys within chart slots; metric keys within metric slots; show red on unfixed code
- [x] 4.2 Backend: example walk asserts no output panel key in KnownKeys union (red by mutation)
- [x] 4.3 Backend: every example Output / Output patch config passes OutputConfigValidation.validateConfig; one has non-null aggregation (red by mutation)
- [x] 4.4 Backend: non-vacuity asserts (>=1 output panel, >=1 Output found)
- [x] 4.5 Remove the no-op `doc shouldBe a[String]`
- [x] 4.6 Live seam probe (design D3) against the worktree app: chart tail create returns 2xx, stored fieldMapping {xAxis,yAxis}, chart renders; throwaway user, residue deleted by exact id
- [x] 4.7 Run gates: frontend lint/typecheck/jest for outputEditor; backend AssistantProposalToolSchemasSpec + PipelineService specs via sbt testFull scope
