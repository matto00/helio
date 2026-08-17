-- HEL-704: issue-invite-code.sql — owner-side manual Beta-access invite-code issuance
-- (design.md D9). Code issuance is deliberately manual for this pass: no self-serve admin UI.
--
-- Resolves a user by email, generates a random single-use code, inserts its sha256 hash into
-- invite_codes (bound to that user's id), and prints the PLAINTEXT code exactly once — this
-- script's own terminal output is the ONLY place the plaintext ever exists; the table only ever
-- stores the hash (design.md D2, mirrors TokenHashing.sha256Hex's session/PAT convention —
-- Postgres's native sha256() produces the identical digest for the identical UTF-8 bytes, so a
-- code issued here redeems correctly via InviteCodeRepository.redeemAndUpgrade).
--
-- MUST run as a BYPASSRLS role (a local dev superuser, or `helio_privileged` — see V34 — in
-- prod). invite_codes has FORCE ROW LEVEL SECURITY (V90): an app-context (non-BYPASSRLS)
-- connection would be rejected by the invite_codes_owner policy, since this script inserts a row
-- on behalf of a DIFFERENT user than whichever role is running it — no app-context session can
-- do that for itself, let alone for someone else.
--
-- Usage:
--   psql "$DATABASE_URL" -v email=requester@example.com -f backend/scripts/issue-invite-code.sql

\echo '== HEL-704: issue Beta-access invite code =='

SELECT id AS requester_id FROM users WHERE email = :'email' \gset

\if :{?requester_id}
\else
  \echo 'No user found for that email -- aborting. No code was issued.'
  \q
\endif

-- Plaintext generated as a psql variable, never written to the database -- 32 lowercase hex
-- characters (a UUID with its dashes stripped), URL-safe and easy to relay by hand or paste.
SELECT replace(gen_random_uuid()::text, '-', '') AS plaintext_code \gset

INSERT INTO invite_codes (id, code_hash, user_id, created_at, redeemed_at)
VALUES (
  gen_random_uuid(),
  encode(sha256(:'plaintext_code'::bytea), 'hex'),
  :'requester_id'::uuid,
  now(),
  NULL
);

\echo 'Code issued -- relay this to the requester now. It will never be shown again:'
\echo :plaintext_code
