# HEL-1277 residue log (shared dev DB)

Every row the e2e spec `e2e/hel1277-output-history-scrubber.spec.ts` created during this run (3 local runs of 4 tests: 10 fresh users, 10 table/chart pipelines, 6 dashboards). Nothing else was created; `matt@helio.dev` was never touched. All deletions were by exact id (the spec's own `finally` via the public API for sources/pipelines/dashboards; users by exact id via psql after removing their `pipeline_run_rate_window` rows by the same exact user ids). Verified afterwards by exact-id counts: 0 rows remain in `data_sources`, `pipelines`, `outputs`, `dashboards`, `panels` (by dashboard id), `output_snapshot_history` (by output id), `users`.

## Users (registered by the spec; tier set to `beta` by exact id via `setUserTierForTest`)

- `17cd4a95-31da-4728-a6e7-a912620711fd` — DELETED (exact id)
- `22c68d34-81cb-470e-a1f6-09141f8b7b16` — DELETED (exact id)
- `41b83b51-6620-43b2-b094-e97737f587a9` — DELETED (exact id)
- `63d71337-784b-421c-aace-743940116b26` — DELETED (exact id)
- `73f0e40c-dfec-49e5-8071-6bfa0224ecac` — DELETED (exact id)
- `7667f369-bd59-44ab-bd7d-f5d8e567708d` — DELETED (exact id)
- `78ad9de6-ff33-4fee-82da-8b68894a867b` — DELETED (exact id)
- `9d942c18-70f9-4d5c-b6cd-9a1cae8d7b84` — DELETED (exact id)
- `b753c776-f001-435f-a552-e707a952106f` — DELETED (exact id)
- `be9b5ebf-1785-46da-a6b4-f2de9f600e0b` — DELETED (exact id)

## Data sources

- `2e46affd-f698-4630-8b71-1165464ef446` — DELETED (exact id, API in spec `finally`)
- `3547e67f-3cb9-4b3c-8713-334e3873ffac` — DELETED (exact id, API in spec `finally`)
- `37fbf40d-1781-4c3c-aa8a-a13002baa7f4` — DELETED (exact id, API in spec `finally`)
- `4bfd1427-6641-4aa9-8463-06229f6873d4` — DELETED (exact id, API in spec `finally`)
- `6efaedac-b097-4545-993c-ab7cac7f7091` — DELETED (exact id, API in spec `finally`)
- `8e875e45-7dcc-4883-b24f-9da474f808ac` — DELETED (exact id, API in spec `finally`)
- `9abc5b8d-688a-4474-915a-71a2c2865632` — DELETED (exact id, API in spec `finally`)
- `a6ff86b0-3bac-4057-8ca2-175557cad996` — DELETED (exact id, API in spec `finally`)
- `bad32434-bb59-42fc-918c-0ccd5382f3a5` — DELETED (exact id, API in spec `finally`)
- `ef06418d-f6b1-4f95-9e17-7cb533d20f05` — DELETED (exact id, API in spec `finally`)

## Pipelines

- `463b3c79-a214-4b37-ac31-c9f1f46e9f48` — DELETED (exact id, API in spec `finally`)
- `6c50be47-6211-4be2-b552-df6ba7ac8584` — DELETED (exact id, API in spec `finally`)
- `73eb6b84-51fe-4c8a-8771-aaa6791f5ee7` — DELETED (exact id, API in spec `finally`)
- `7d1c2e3e-b1c7-4019-9426-dd01c0731d2a` — DELETED (exact id, API in spec `finally`)
- `7e56e945-6304-478d-b50a-3fe1741947e9` — DELETED (exact id, API in spec `finally`)
- `856336d8-f465-4e08-b4c4-922e1caebc2c` — DELETED (exact id, API in spec `finally`)
- `9a653097-33b5-41cd-a02e-44f6c58e9237` — DELETED (exact id, API in spec `finally`)
- `af5cd8e0-6808-4618-b739-64e2235f59d5` — DELETED (exact id, API in spec `finally`)
- `d9996dc5-1470-4d91-b98d-28c8351cec45` — DELETED (exact id, API in spec `finally`)
- `f1a8075e-62e5-4ab5-9527-b3991218b2d0` — DELETED (exact id, API in spec `finally`)

## Outputs (cascade-deleted with their pipeline)

- `23207f91-260b-4876-9445-67e9a9d54dab` — DELETED (cascade; exact-id count 0 verified)
- `26b106dd-fefa-42d8-9fd2-ad80ff0cddf6` — DELETED (cascade; exact-id count 0 verified)
- `29cc147e-7547-4c2e-88db-8c4a08d4542b` — DELETED (cascade; exact-id count 0 verified)
- `a8553116-deb7-4e79-b823-8d26cf2b83e0` — DELETED (cascade; exact-id count 0 verified)
- `c2710ad5-41eb-4abd-a5fb-268553fe1e94` — DELETED (cascade; exact-id count 0 verified)
- `cdbb35cc-2a1d-4b80-99d7-d768987be75f` — DELETED (cascade; exact-id count 0 verified)
- `dc80167f-e5e3-4526-afe8-180923195df6` — DELETED (cascade; exact-id count 0 verified)
- `e124b474-c0d4-44ea-bf26-51470853acca` — DELETED (cascade; exact-id count 0 verified)
- `e8ccecf3-9c97-47a3-acd6-ed5cc711628a` — DELETED (cascade; exact-id count 0 verified)
- `faadedb2-8f94-4b6b-a2fa-b62070cb0602` — DELETED (cascade; exact-id count 0 verified)

## Dashboards (panels cascade-deleted with them)

- `5963ea53-d28e-4ad2-9b78-055022cd9acb` — DELETED (exact id, API in spec `finally`)
- `8e6ad439-7108-4c6a-8c72-e4f1d3705d54` — DELETED (exact id, API in spec `finally`)
- `acd7b982-e86b-48ae-be00-abf9e1f1ec02` — DELETED (exact id, API in spec `finally`)
- `ae2ee0da-28a1-44f8-acb3-cd40c1eb4632` — DELETED (exact id, API in spec `finally`)
- `cc4725a3-84e1-4512-8ce6-be433400fbce` — DELETED (exact id, API in spec `finally`)
- `dda25849-5aae-417e-a62e-12f0b75ea9ec` — DELETED (exact id, API in spec `finally`)


## Evaluator cycle 1 (2026-10-06)

Created on the shared dev DB by the evaluator (e2e re-run + manual UI seeding). All deleted by exact id;
verified afterwards by exact-id counts (0 rows in `users`, `dashboards`, `pipelines`, `data_sources`,
`outputs`, `panels`, `output_snapshot_history`, `share_tokens`, `pipeline_run_rate_window`). `matt@helio.dev` never touched.

- Users (tier set to `beta` by exact id): `c262341b-5529-42e2-942c-405800d16462` (manual UI seed),
  `ba40fba7-00e6-4920-af17-3f4aeea102b6`, `464eafc8-1242-4006-bfb4-88745b3f435c`,
  `fab3f302-90c0-475d-9689-6646a93918b7`, `3951f0ec-12de-47fa-9adf-521b948d437d` (e2e re-run; the spec's
  `finally` deleted their sources/pipelines/dashboards) — DELETED (exact id, psql, after their
  `pipeline_run_rate_window` rows by the same exact user ids)
- Manual seed under `c262341b…`: source `cdca9371-02a1-424a-9af8-b69ec661a11f`, pipeline
  `4b5535f9-da97-4fa1-ac14-9bfe084f1328` (outputs `592567a5-c669-4db8-9e45-d76f5cbab5c9`,
  `d86ad202-0713-42bb-af58-b74f71cf9a07`, `dc5a300f-3f5c-4ddf-9e52-d5ef86b0fd14`), dashboard
  `1a553a20-1cf2-4beb-99ea-a6def0ec1c59` (panels `6b50c8cf-b6c4-4b54-b017-bef6d0237bfa`,
  `42b3c154-19b9-46b6-b59c-7b44af7e58aa`; public viewer grant; share token
  `fc109943-2835-4cc3-9429-137927cd1f8c`) — DELETED (exact id, API)
- MISATTRIBUTED (shared-scratchpad cookie-jar collision, see evaluation report): created under another
  evaluator's user `07485b24-9d5c-48ae-9d66-91f39f9a7930` (hel1326-eval-c1-…, NOT deleted — not ours):
  source `d05c893e-9b86-47f3-82f4-4bd4ac9bebd3`, pipeline `8a41c087-d6ab-4b52-920f-461d79f54254`
  (outputs `ee94a254-b9ac-4c0f-8795-005bdf69664c`, `0e3dd734-ae2b-4008-ba84-f4978d0657a7`,
  `d542d36d-a2fe-4c5a-bb43-32ef9d9ccfd0`), dashboard `a71b4bee-554d-4b52-9429-948e8a9f6ad5` (panels
  `fd3876cc-f946-4d3c-a666-3d7c4e911ec3`, `04dc759c-0bc2-4048-8e33-f692a29a5982`, one share token) —
  DELETED (exact id, API) ~2 min after creation. That user's own `pipeline_run_rate_window` rows gained 4
  run submissions from these runs; left in place (not ours to delete).

## Cycle 2 (e2e run 4: 4 tests)

All deleted by exact id (sources/pipelines/dashboards via the spec `finally`; users by psql with their `pipeline_run_rate_window` rows, same exact ids). Exact-id counts afterwards: 0 in every table.

### Users
- `0f930202-a4b0-4528-901e-2c69639f1320` — DELETED (exact id)
- `1f7ccc7b-3aa8-47bd-bac4-0d3fdaa5b5f0` — DELETED (exact id)
- `9da6fdbd-51e4-4ab2-af52-66ddf658d4a6` — DELETED (exact id)
- `f5359bbc-0e05-4c38-9cfc-eb7c47540e2e` — DELETED (exact id)

### Data sources
- `264703bd-b2aa-432c-a617-2243f05cf21b` — DELETED (exact id)
- `39de2bc1-fdd9-4821-9dfd-6bd309683a5f` — DELETED (exact id)
- `3faa4554-4149-4059-9af4-a075b957ef9f` — DELETED (exact id)
- `ca3df347-709a-4aa0-83a0-8216c059c967` — DELETED (exact id)

### Pipelines
- `2946f9fb-0ee0-4599-8a3b-22cf3a0ccd1f` — DELETED (exact id)
- `5b322fb2-7c02-432d-841a-513e1eea3854` — DELETED (exact id)
- `7ecfc2a0-49ab-4e79-8798-67ea7e9d428c` — DELETED (exact id)
- `b58e68b0-7558-4b91-a7e5-e54b9a9a4960` — DELETED (exact id)

### Outputs (cascade)
- `2f839ce2-033e-4817-bf43-022bcd25fb87` — DELETED (exact id)
- `686b5ce6-bb06-444f-a44c-2f84d800bd2e` — DELETED (exact id)
- `a7ce12c3-1520-4f75-b23e-76fd7fe4344c` — DELETED (exact id)
- `d2d52a29-10ab-46dd-b40f-359a26701faf` — DELETED (exact id)

### Dashboards
- `701dd01c-b481-45f1-9ede-96ef1db0ef66` — DELETED (exact id)
- `e7c4f613-6fb9-41ef-ab3e-d96356d86712` — DELETED (exact id)


## Evaluator cycle 2 (2026-10-06)

All deleted by exact id. Afterwards, exact-id counts were verified at 0 in `users`, `dashboards`, `pipelines`, `data_sources`,
`output_snapshot_history` and `pipeline_run_rate_window`. `matt@helio.dev` was never touched. The cookie jar was kept inside the worktree this time.

- Users (tier `beta` by exact id), DELETED by exact id with psql after their `pipeline_run_rate_window` rows:
  - `b5728880-9579-4884-b7e6-ba173fa69398` (manual UI seed)
  - `554104b2-893f-4f65-8837-c1a016e6b5d0`, `f2566984-b529-4236-8311-8bf4848222af`, `100bba65-2384-455a-a98d-cd21fe55fda0`, `f4c7b4bc-0487-419b-8d37-b7f2bdf2f30a` (e2e re-run)
- e2e resources, DELETED by the spec's `finally`, counts verified at 0:
  - sources `d414256f-047f-439b-b635-c312fabc73b4`, `c36fe84e-5916-474e-9fbe-f19d0fdee949`, `423bf79f-4e66-4a24-bc7b-367ac8660dcb`, `f62e0df2-854d-42df-a01a-bca30d67b743`
  - pipelines `325e21ac-51b9-4c68-9876-58709e9ee1e4`, `a49af50e-8ac4-44b6-b022-6fbcdb4fc62c`, `c738fb44-5218-4ce0-873d-8f5214ff83b0`, `4370db0c-6275-4f96-a08e-527a0b68a442`
  - outputs cascaded with their pipelines
  - dashboards `aeb3b174-8fc0-4e67-b3f7-c43fe7bb4ec7`, `df51a8ba-61e0-49fe-a36e-266c83798044`
- Manual seed under `b5728880…`, DELETED by exact id through the API:
  - source `4d6e2b8d-4011-4d08-ab6b-1d91654bc24b`
  - pipeline `5e0c7699-08b4-4856-95a7-a45356a1d898` (outputs `f3d1b920-7e72-4da6-b5a6-990bb6342a47` and `42aba5a2-dfa8-4c08-86e0-ee41e6755c03`)
  - dashboard `58eda594-a2fe-44c5-a735-a724d9ed6077` (panel `920dc764-06fc-4b2d-b183-140accb21928`)

## Skeptic final gate round 1 (2026-10-06)

All deleted by exact id; exact-id counts verified at 0 in `users`, `dashboards`, `pipelines`, `data_sources`. `matt@helio.dev` never touched (excluded in SQL).

- Users (tier `beta` by exact id), DELETED by exact id with psql after their `pipeline_run_rate_window` rows:
  - `d85d128d-a97f-4566-bbfc-413575ca29f1` (skeptic probe seed)
  - `c33a3338-ad2d-4201-94a8-e0533ad23f06`, `2fdf877a-77d7-49a2-8273-3326ce3bfe1d`, `e8612371-7285-49c6-a648-64ec92f0ac7f`, `a969ae3e-f359-4e1b-8c68-c28cd5d592f8` (e2e re-run)
- e2e resources, DELETED by the spec's `finally`, counts verified at 0:
  - sources `c7e996a0-92c1-4602-81cd-1d76278dd947`, `0bea74f8-3f4e-4794-8faa-e11fe26c2c71`, `266f9df3-bc32-454b-929a-06d3257b34c2`, `21799b8c-d19f-42d2-bc82-445370231516`
  - pipelines `67c864f5-fa16-4944-bb69-96831b2074ff`, `48fb9c72-1243-44d3-8a91-5218fec7a66b`, `af66362c-bc07-487f-ae58-9c3da254751c`, `dd1fab38-7b30-469a-a6b2-23d1b3db7953` (outputs cascaded)
  - dashboards `028e47dd-e8ae-47ba-9143-78e05162d718`, `02680159-3d76-48cd-a48d-9dad22170cd7`
- Skeptic probe seed under `d85d128d…`, DELETED by exact id through the API:
  - source `bf7f95b5-5815-4370-af3f-ce11c3d2741d`
  - pipeline `8f3dfdde-18ce-4457-8499-888135674c31` (outputs `ae9e7d96-0da7-4a1e-98c6-1a3fcabb7ea4`, `606f7197-5188-4eb2-8e07-1b3972975132`)
  - dashboard `11a84a62-7093-42d6-b424-d3a4ee555dc7` (panels `bda49d0e-7689-4771-9ea9-7e99aa4eb34d`, `5ada0a52-3667-4214-ba82-38a8a5995b9c`; share tokens `08924e3f-6f8a-4c01-bb12-12bd36d485c1`, `3984e6b8-7d24-4f54-a111-024f80e51828`)
