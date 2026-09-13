## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 9f7bd3838452cb7e76393e6b4fc38d171297c239 (planning artifacts only, no implementation commits).

### What I verified (with evidence)

- **CR1 (spec parity): ADDRESSED.** The proposal lists `pipeline-steps-persistence` as a Modified Capability. `.openspec.yaml` no longer has `skip_specs`. I diffed the delta's MODIFIED requirement against `openspec/specs/pipeline-steps-persistence/spec.md` (lines 12-64). Only three things differ: the op tuple (now 27 ops, matching V83 plus the four new ones), the "via Vxx" history sentence, and the THEN clause of "created on migration". Every other scenario in that requirement is carried over word for word. The new V107 scenario is appended. It cites the existing "Returns 400 for invalid type discriminator" scenario (spec.md:183-186), which exists.
- **CR2 (API-rejection layer): ADDRESSED.** `PipelineService.scala:521` (the transactional create path) and `validateStepKinds` at `:1495` both gate on `PipelineStepKind.All.contains` and return `ServiceError.BadRequest`. Decision 4 and task 2.3 now target those checks, not analyze's "Unknown op". This departs from the ticket AC's wording, but it corrects a false premise in the ticket, and the design says why. Acceptable.
- **CR4 (shared dev DB): ADDRESSED.** Task 1.2 is now a manual, non-authoritative smoke check. The proof is moved to isolated EmbeddedPostgres tests.
- **CR5 (seeded rows): ADDRESSED.** Task 2.1 seeds all 23 ops and adds the negative control that a bogus op is still rejected.
- **CR3 (role proof): REWORKED INTO A PLAN THAT CANNOT RUN AS WRITTEN.** Decision 2 and task 2.2 now say: run the FULL Flyway chain V1-V107 on a fresh EmbeddedPostgres, connected as a dedicated role created with neither SUPERUSER nor BYPASSRLS. The design argues this "match[es] prod exactly". Ground truth contradicts that:
  - `V34__rls_privileged_role.sql:14-26` runs `CREATE ROLE helio_privileged BYPASSRLS NOLOGIN` whenever the role is absent, which it always is on a fresh instance. It then runs `GRANT helio_privileged TO current_user`. Creating a role with `BYPASSRLS` requires superuser in PostgreSQL. A plain non-superuser cannot do it, and even a CREATEROLE role must itself hold BYPASSRLS.
  - `docs/cloud-dev-setup.md:166` records this exact failure: "Flyway V34 `permission denied to create role` | DB user lacked `CREATEROLE` | Grant `SUPERUSER` to `helio`".
  - `V40` and `V100:88-94` also run `ALTER FUNCTION ... OWNER TO helio_privileged` and `GRANT ... TO helio_privileged`. Those need membership in, or admin over, that role.
  - So a fresh restricted role running the full chain fails at V34. That is long before V107, and for a reason unrelated to this ticket. The executor would then have to improvise pre-provisioning (create `helio_privileged` as superuser, grant membership, perhaps CREATEROLE). That is the unspecified-decision gap this gate exists to catch. Worse, an improvised fix could quietly re-grant broad privilege and make the proof unfalsifiable again.
  - The "matches prod exactly" claim is also unsupported. I searched docs/, infra/, .github/ and CONTRIBUTING.md and found no record of how prod's `helio` and `helio_privileged` were provisioned: whether `helio_privileged` already exists before Flyway, or what role attributes `helio` holds. Round 1's CR3(d) asked for this to be recorded. It was dropped, not answered.
  - Round 1's CR3(c) negative control was also dropped. Running as the owner under the full chain partly makes it moot, but only if the chain can actually run.
- tasks.md still ends with an empty "## Standing Constraints" heading (cosmetic).

### Verdict: REFUTE

### Change Requests

1. **Make task 2.2 / Decision 2 executable and truthful about V34.** Pick one of these and specify it concretely:
   - (a) As superuser, pre-provision exactly what prod pre-provisions: `CREATE ROLE helio_privileged BYPASSRLS NOLOGIN`, create the restricted login role `NOSUPERUSER NOBYPASSRLS` (state whether it gets `CREATEROLE`), and `GRANT helio_privileged TO <restricted> [WITH ADMIN OPTION if V34's GRANT needs it]`. Then run the full chain as the restricted role and assert `rolsuper`/`rolbypassrls` are false for `current_user`.
   - (b) Run V1-V106 as superuser, then `ALTER TABLE pipeline_steps OWNER TO <restricted>`, then apply V107 as the restricted role (round 1's CR3(a)), plus a negative control where a non-owner non-superuser fails.

   In either case, list the exact grants, so the executor is not left inventing them.
2. **Record prod's actual provisioning, or drop "matches prod exactly".** Cite where `helio_privileged` and `helio`'s attributes come from in prod (a setup script, deploy doc, or a `pg_roles` capture). If no source exists, say so explicitly. In that case the design should claim only "V107's DDL succeeds for a non-superuser table owner", and should note that V107 adds no role, grant, or function-ownership statements, so its privilege needs are strictly ownership of `pipeline_steps`.
3. Remove the empty "## Standing Constraints" heading from tasks.md (non-blocking; do it alongside the above).

### Non-blocking notes
- Keep V83's header-comment style in V107 (list the prior drop/re-add migrations).
- Task 2.3: the per-step route `POST /api/pipelines/:id/steps` is the cleanest pin. Confirm its handler really calls `PipelineStepKind.All` (lines 521 and 1495 cover the transactional create and proposal paths). If `addStep` has its own check elsewhere, cite that line.
