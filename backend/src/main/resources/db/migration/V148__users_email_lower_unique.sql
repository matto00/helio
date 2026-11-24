-- HEL-1852: emails are normalised (trimmed, lower-cased) at every auth entry point, and the database
-- now enforces case-insensitive uniqueness. Before this, `users.email` was case-sensitive UNIQUE
-- while the owner allowlist matched case-insensitively, so a case-variant of an allowlisted address
-- could register as a second account.
--
-- Normal form (the same expression is used by the duplicate check, the UPDATE and the release
-- checklist's prod pre-check): trim every leading/trailing char in U+0001..U+0020 (Java String.trim;
-- Postgres text cannot hold U+0000) and lower-case. The regex lives in standard string literals
-- (never an E'' literal, which would change the meaning of \x01).
--
-- Fails LOUDLY, changing nothing (one Flyway transaction), when rows already collide in that normal
-- form. It never merges or drops rows: duplicates must be resolved manually first.

DO $$
DECLARE
  collisions integer;
BEGIN
  SELECT count(*) INTO collisions FROM (
    SELECT lower(regexp_replace(email, '^[\x01-\x20]+|[\x01-\x20]+$', '', 'g'))
    FROM users
    GROUP BY 1
    HAVING count(*) > 1
  ) dup;
  IF collisions > 0 THEN
    RAISE EXCEPTION 'HEL-1852 / V148: case-insensitive email duplicates exist (% group(s) of users share an email that differs only by letter case or surrounding whitespace); no rows were changed. Resolve these duplicates manually, then re-run the migration.', collisions;
  END IF;
END
$$;

UPDATE users
SET email = lower(regexp_replace(email, '^[\x01-\x20]+|[\x01-\x20]+$', '', 'g'))
WHERE email <> lower(regexp_replace(email, '^[\x01-\x20]+|[\x01-\x20]+$', '', 'g'));

-- No IF EXISTS: a drifted constraint name must fail the migration loudly.
ALTER TABLE users DROP CONSTRAINT users_email_key;

CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
