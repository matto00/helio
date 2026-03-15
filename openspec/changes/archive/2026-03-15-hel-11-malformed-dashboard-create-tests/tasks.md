## 1. Add Negative-Path Tests

- [x] 1.1 Add test case for type-mismatch on `name` field (`{"name": 42}` → 400) in `ApiRoutesSpec`
- [x] 1.2 Add test case for structurally invalid JSON (`{invalid}` → 400) in `ApiRoutesSpec`

## 2. Verification

- [x] 2.1 Run `sbt test` in `backend/` and confirm all tests pass
