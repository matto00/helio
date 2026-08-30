-- HEL-904 task 3.5: `PipelineRepository.create` stops minting a DataType for
-- every new pipeline (design.md "Output model" -- a pipeline's panel-bindable
-- output is now an explicit Output row, created separately, not an implicit
-- DataType at pipeline-creation time). `pipelines.output_data_type_id` stays
-- in place and readable (task 2.10 / section 4 still owns the eventual drop)
-- so every pre-existing pipeline's legacy DataType binding keeps working --
-- this migration only relaxes the NOT NULL constraint so a newly-created
-- pipeline can leave it unset.
ALTER TABLE pipelines ALTER COLUMN output_data_type_id DROP NOT NULL;
