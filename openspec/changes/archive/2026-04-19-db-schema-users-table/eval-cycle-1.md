# Evaluation Report — HEL-30 Cycle 1

**Verdict: PASS**

---

## Spec Compliance

All four tasks from `tasks.md` are completed:

| Task | Status |
|------|--------|
| 1.1 V9 migration (auth_provider enum, nullable password_hash, updated_at) | ✅ |
| 2.1 AuthProvider sealed trait in domain model | ✅ |
| 3.1–3.4 UserRow/UserTable passwordHash → Option[String], insert/upsert callers updated | ✅ |
| 3.5 getPasswordHash fix (flatten Option[Option[String]]) | ✅ |

---

## Acceptance Criteria

| Criterion | Result |
|-----------|--------|
| Migration runs cleanly on a fresh DB | ✅ V6→V9 chain is valid; new columns are nullable or have defaults |
| email and google_id have unique constraints | ✅ email UNIQUE in V6; google_id partial unique index in V8 |
| password_hash never returned by any API response | ✅ UserResponse excludes it; fromDomain only maps safe fields |

---

## Notes

**auth_provider and updated_at columns are unmapped in Slick (deliberate deferral)**
- V9 adds both columns to the DB, but neither appears in `UserRow`, `UserTable`, or the `User` domain model.
- This is safe: Slick generates explicit column lists (not `SELECT *`), so unmapped DB columns don't cause projection errors. `auth_provider` is nullable; `updated_at` has `DEFAULT now()`, so inserts succeed without them.
- `AuthProvider` was added to the domain model as the sealed trait, ready to be wired in when the auth flow needs it.
- Acceptable as a foundation ticket — these columns are schema-forward, not yet behaviorally active.

**auth_provider column is always NULL for new rows**
- V9 adds the column with no default and no NOT NULL. No code path sets it.
- This means the enum column exists but is inert until a future ticket wires it into `insert`/`upsertGoogleUser`.
- Low risk now, but whoever adds the NOT NULL constraint later will need a backfill migration.

**updated_at is set on insert but never updated**
- No trigger or explicit UPDATE is wired up. The column tracks creation time only for now.
- Expected for this scope; a future ticket should add either a DB trigger or explicit update calls.

---

## Code Quality

- The `getPasswordHash` flatten fix is correct: Slick returns `Option[Option[String]]` when the column is `column[Option[String]]` and `result.headOption` is used.
- Timing-safe dummy bcrypt comparison on missing email (pre-existing pattern) is preserved correctly.
- `upsertGoogleUser` race condition (findByGoogleId → insert) is pre-existing, not introduced here.
