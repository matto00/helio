-- HEL-288: hash session tokens at rest, matching the api_tokens approach.
--
-- user_sessions.token has stored the raw 64-char hex session token since
-- V7/V11. A raw value already in the column can't be forward-hashed and
-- trusted as "the hash the app would have produced" without a pgcrypto
-- dependency, so this migration deletes existing sessions instead of
-- rehashing them: every logged-in user is signed out once on rollout and
-- must log in again (acceptable for a session store per the ticket).
--
-- After this migration, only SHA-256(raw token) is ever stored — see
-- TokenHashing.sha256Hex and UserRepository.createSession/findSession/
-- deleteSession, and SlickUserSessionRepository.findValidSession.
DELETE FROM user_sessions;

ALTER TABLE user_sessions RENAME COLUMN token TO token_hash;
ALTER TABLE user_sessions RENAME CONSTRAINT user_sessions_token_unique TO user_sessions_token_hash_unique;
