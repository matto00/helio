# Dev DB rows created by the HEL-1007 executor (exact ids; cleanup by exact id only)

Backend: http://localhost:9346 (this worktree, verified via /proc/<pid>/cwd). All rows were deleted
through the API as their owning user (login with password `correcthorsebattery1`), by exact id.
User rows cannot be deleted through the API; their emails are listed so the orchestrator can remove
them by exact email if it wants.

| run | user email | pipeline | sources | state |
| --- | --- | --- | --- | --- |
| spec run 1 (red) | hel1007-1790964402511-7483@example.com | f5748bf7-9a28-42f7-b87b-829a0516a37b | 91c6c24a-43eb-4940-b4ba-e3a93e831141, b634f581-2631-4b2f-a2ab-a9d0d56d8abe | deleted (204) |
| spec run 2 (red) | hel1007-1790964446121-98960@example.com | 0a54a039-d896-4e9c-be73-ebf93c6c3498 | 3648a4ab-f80a-44c8-95ba-4f1e65fbbc65, 2f25cf78-a8ed-40a7-be1f-6ec99d2736cc | already gone (spec finally deleted; 404) |
| spec run 3 (red) | hel1007-1790964471714-52581@example.com | 68cb474d-bab9-4a90-bd86-c50838162cb3 | 7f1961c9-3107-4adc-b2c5-5ca2e5d4a3ea, 7970662b-f14d-40c0-a4f3-b100c5fefc87 | already gone (404) |
| spec run 4 (red) | hel1007-1790964495831-20714@example.com | 2a5a5b0b-69fb-4fae-b6a8-d7db3baef134 | 7def2b0f-5dc9-4dd3-b506-d37dfaa4c76c, 584bbe55-1022-478f-ba7f-4b8c79c269ce | already gone (404) |
| spec run 5 (red, final) | hel1007-1790964517977-78437@example.com | d6691190-9072-4fd0-b46c-ffb2c4c618b5 | 70790c57-a715-425b-a9a6-f86cb492d841, da2b3a4f-17dd-4557-b881-3d61b5fa6c1d | already gone (404) |
| curl probe (step-create anchoring) | hel1007-probe-14901@example.com | b1c8cad8-c7e7-48e8-a0ed-3d1fad01b33d | c1b764fe-bbf7-4746-9874-2413e9f467d5 | deleted (204) |
| repro-before script | hel1007-repro-1790964567999@example.com | 6631a954-f672-41f0-b4a1-76bb4d63f75a | 0ff86f27-1366-4d8d-bce7-cf6537f1bfd9, 5f23de59-ab1e-42f8-84b5-eab93475884c | deleted (204) |

Step ids for the repro-before run are in evidence/repro-before-ids.json.

## Spec run 6 (first green attempt, assertion bug in spec, finally-block deletes)
user hel1007-1790964712831-67305@example.com, pipeline 87024d00-b650-44e6-9709-eb1f52ac5cdb, sources 6e7c2961-1c39-4aeb-ad71-3851caa6a1da, cec58f36-3d9e-4dc0-baab-46a81875aace

## Spec run 7 (green) — deleted by spec finally
user hel1007-1790964726906-79888@example.com, pipeline dda71c9a-92f9-4ccb-8fd3-ed88ba01f247, sources a16a2d61-0e3c-43ba-abaa-afe7cb3bf8eb, 9f54c82d-7272-4764-b0c8-b97ebba834f5

## Contract proof curl (evidence/contract-proof.txt) — deleted (204)
user hel1007-contract-22263@example.com, pipeline c569951b-a1fd-4f5e-9176-e24917dc7913, sources 950d311a-21f3-4dd8-a43f-a8c04e2adcde, 3fa015e0-5140-4b18-8dcf-8de8898599bb

## Spec run 8 (green, with hel908 specs) — spec's own finally deletes
user hel1007-1790965060866-8612@example.com, pipeline 24921699-9525-4a88-a082-12cb79759bb7, sources 0cee8e77-ffd2-4f17-af48-549f9f279e1c, a1a1c8fa-2ed4-40f7-b645-c7a0d238873d

## repro-after script — deleted (204)
user hel1007-repro-1790965092537@example.com; ids in evidence/repro-after-ids.json
