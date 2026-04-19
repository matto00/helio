-- Insert system user; all pre-existing resources will be assigned to this owner
INSERT INTO users (id, email, created_at)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'system@helio.internal', now())
ON CONFLICT DO NOTHING;

-- Add owner_id to dashboards; DEFAULT auto-backfills existing rows (tasks 1.2 + 1.4)
ALTER TABLE dashboards
  ADD COLUMN owner_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES users(id);

-- Add owner_id to panels; DEFAULT auto-backfills existing rows (tasks 1.3 + 1.4)
ALTER TABLE panels
  ADD COLUMN owner_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES users(id);
