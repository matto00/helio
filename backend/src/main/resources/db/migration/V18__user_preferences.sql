-- Add preferences column to users table (stored as JSON text)
ALTER TABLE users ADD COLUMN preferences TEXT;

-- Create user_dashboard_zoom table for per-dashboard zoom levels
CREATE TABLE user_dashboard_zoom (
  user_id      UUID NOT NULL,
  dashboard_id TEXT NOT NULL,
  zoom_level   DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (user_id, dashboard_id),
  CONSTRAINT fk_user_dashboard_zoom_user      FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE,
  CONSTRAINT fk_user_dashboard_zoom_dashboard FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
);
