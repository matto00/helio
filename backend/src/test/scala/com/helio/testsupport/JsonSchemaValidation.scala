package com.helio.testsupport

import com.fasterxml.jackson.databind.ObjectMapper
import com.networknt.schema.{JsonSchema, JsonSchemaFactory, SpecVersion}
import org.scalatest.Assertions.fail

import java.io.File
import scala.jdk.CollectionConverters._

/**
 * Shared JSON-Schema-2020-12 validation harness for backend ScalaTest specs that assert a
 * response body against a `schemas/` contract file — not just a Scala-side
 * round-trip deserialization, which cannot catch a schema `required` list disagreeing with
 * spray-json's omit-`None`-fields wire behavior (the exact bug HEL-371's evaluation-1.md found;
 * see `WorkspaceContextServiceSpec`'s original inline copy of this harness).
 *
 * Extracted out of `WorkspaceContextServiceSpec` (HEL-372 tasks.md 4.1, pre-approved by the
 * ticket brief) once that spec — already at 431 lines, past CONTRIBUTING's ~400-line guidance —
 * needed the identical harness duplicated for a second time rather than grown further.
 */
object JsonSchemaValidation {

  private val jsonMapper = new ObjectMapper()

  /**
   * Locates `schemas/<relativePath>` (e.g. `"workspace-context.schema.json"`) by walking up
   * from the test JVM's working directory — robust to whether sbt forks tests with cwd
   * `backend/` (the normal case) or the repo root.
   */
  def schemaFile(relativePath: String, searchDepth: Int = 5): File = {
    def search(dir: File, depthRemaining: Int): File = {
      val candidate = new File(dir, s"schemas/$relativePath")
      if (candidate.exists()) candidate
      else if (depthRemaining <= 0 || dir.getParentFile == null)
        fail(s"could not locate schemas/$relativePath searching upward from " +
          new File(".").getCanonicalPath)
      else search(dir.getParentFile, depthRemaining - 1)
    }
    search(new File(".").getCanonicalFile, searchDepth)
  }

  /** Compile `schemas/<relativePath>` once (JSON Schema 2020-12). */
  def compile(relativePath: String): JsonSchema =
    JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(jsonMapper.readTree(schemaFile(relativePath)))

  /**
   * Real ajv-equivalent validation (networknt/json-schema-validator, JSON Schema 2020-12) of a
   * compact-printed JSON string against a pre-compiled schema. Returns an empty `Vector` when
   * the document validates.
   */
  def validationErrors(schema: JsonSchema, compactJson: String): Vector[String] =
    schema.validate(jsonMapper.readTree(compactJson)).asScala.map(_.getMessage).toVector
}
