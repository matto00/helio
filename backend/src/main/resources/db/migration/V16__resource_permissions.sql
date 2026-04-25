-- Resource permissions table for dashboard/panel sharing
CREATE TABLE resource_permissions (
  resource_type VARCHAR(50) NOT NULL,
  resource_id TEXT NOT NULL,
  grantee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at TIMESTAMP NOT NULL DEFAULT now(),

  -- Ensure one grant per user per resource
  CONSTRAINT unique_grantee_per_resource UNIQUE (resource_type, resource_id, grantee_id)
);

-- Partial unique index: only one public grant (grantee_id IS NULL) per resource
CREATE UNIQUE INDEX unique_public_grant_per_resource
  ON resource_permissions (resource_type, resource_id)
  WHERE grantee_id IS NULL;

-- Index for efficient permission lookups
CREATE INDEX idx_resource_permissions_resource
  ON resource_permissions (resource_type, resource_id);

CREATE INDEX idx_resource_permissions_grantee
  ON resource_permissions (grantee_id)
  WHERE grantee_id IS NOT NULL;
