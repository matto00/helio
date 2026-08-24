# Spark

Apache Spark job submission and result caching for pipeline execution:
`SparkJobSubmitter`, `PipelineRunCache`.

**Belongs here:** Spark-cluster integration — submitting jobs and caching
their results.
**Does not belong here:** pipeline step/shape logic itself, which lives in
`domain.steps`/`domain.shapes`; this package only runs it on Spark.
