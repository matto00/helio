-- HEL-1504 (design.md D2): counts how many times a pending dataset-write auto-run has been
-- re-armed after a pipeline-run guard rejection (HEL-505). The firer re-arms the row after the
-- guard's Retry-After until this reaches PIPELINE_RUN_AUTO_RUN_MAX_RETRIES, then drops it with a
-- WARN. A fresh dataset write resets it to 0. Additive; old code ignores the column.
ALTER TABLE pipeline_auto_run_debounce ADD COLUMN guard_retry_count INT NOT NULL DEFAULT 0;
