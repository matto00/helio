## Standing Constraints

## 1. Reproduce

- [x] 1.1 Live repro: own @example.test user, cast step with a legacy target set in the DB, edit another row; record the 422 and the unchanged stored config in run evidence
- [x] 1.2 Duplicate audit tests (ScalaTest, VerifiedEmbeddedPostgres.start) for lane, upsert and secondary-source; record red output in run evidence
- [x] 1.3 Return ESCALATION with the secondary-source repro and data-reach evidence BEFORE starting 2.x (design D4)

### Backend

- [x] 2.1 duplicateStep runs validateLaneReference for the clone's prospective chain (if 1.2 reproduced); lane test goes red to green
- [x] 2.2 duplicateStep runs upsertOwnershipCheckF with the pipeline owner (if 1.2 reproduced); upsert test goes red to green
- [x] 2.3 Secondary-source per the owner's ruling: (a) close it, check in duplicate, test red to green; or (b) a characterization test naming the ruling

### Frontend

- [x] 3.1 Cast persist passes captureErrors; CastFieldsConfig takes saveError props and renders InlineError (FillNullConfig pattern); hook/card test red then green
- [x] 3.2 CastFieldsConfig marks a legacy row invalid with ariaInvalid/ariaDescribedBy and the hint copy; test red then green
- [x] 3.3 CastFieldsConfig renders rows for stored keys outside the schema; test red then green

### Tests

- [x] 4.1 Mutation check: remove captureErrors for cast and confirm 3.1's test fails; record in evidence
- [x] 4.2 Run lint, typecheck, format, jest, targeted sbt (showing [hel1468-guard]) and affected e2e specs; record in evidence
- [x] 4.3 Live verification in the running app (both themes) that the 422 shows and keep-as-is clears it
