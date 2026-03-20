ALTER TABLE panels
    DROP CONSTRAINT panels_dashboard_id_fkey,
    ADD CONSTRAINT panels_dashboard_id_fkey
        FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE;
