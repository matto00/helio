CREATE TYPE auth_provider AS ENUM ('google', 'local');

ALTER TABLE users ADD COLUMN auth_provider auth_provider;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
