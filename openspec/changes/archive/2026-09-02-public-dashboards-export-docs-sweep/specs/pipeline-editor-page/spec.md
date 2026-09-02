## MODIFIED Requirements

### Requirement: Bound-type bar displays the pipeline's output DataType
The page header SHALL show source, schedule, run status, and the pipeline's total Outputs count
("Outputs (N)"). The "Output type" link and any DataType-bound header field are removed; the page
SHALL NOT fetch `state.dataTypes.items` or reference the retired `outputDataTypeName`/`output_data_type_id` fields.

#### Scenario: Page header shows the output type name
- **WHEN** `PipelineDetailPage` is rendered with a loaded `currentPipeline` that has 4 Outputs
- **THEN** the page header shows "Outputs (4)" and no "Output type" link is present

