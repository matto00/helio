### Backend

## 1. Database Migration

- [ ] 1.1 Create `V9__users_schema_fix.sql`: add `auth_provider` enum type (`google`, `local`), add `auth_provider` column to `users`, alter `password_hash` to DROP NOT NULL, add `updated_at` column with default `now()`

## 2. Domain Model

- [ ] 2.1 Add `AuthProvider` sealed trait with `Google` and `Local` cases to `backend/src/main/scala/com/helio/domain/model.scala`

## 3. Repository Layer

- [ ] 3.1 Update `UserRow.passwordHash` from `String` to `Option[String]` in `UserRepository.scala`
- [ ] 3.2 Update `UserTable.passwordHash` column mapping from `column[String]` to `column[Option[String]]`
- [ ] 3.3 Update `UserRepository.insert` signature: `passwordHash: Option[String]` instead of `String`
- [ ] 3.4 Update `upsertGoogleUser`: pass `passwordHash = None` instead of `passwordHash = ""`
- [ ] 3.5 Fix `rowToDomain` projection if any new columns are mapped (keep `UserRow` in sync with `UserTable`)

### Tests

## 4. Backend Tests

- [ ] 4.1 Run `sbt test` and fix any compilation failures caused by the `UserRow` signature change (update any test fixtures that call `insert` or construct `UserRow` directly)
