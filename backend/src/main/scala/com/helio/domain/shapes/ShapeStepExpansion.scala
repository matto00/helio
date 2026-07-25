package com.helio.domain.shapes

import spray.json.JsObject

/** One expanded pipeline step produced by [[PipelineShape.expand]] — a domain-level mirror of
 *  `com.helio.api.protocols.CreatePipelineStepRequest`'s two-field shape (`kind` positionally
 *  mirrors that DTO's backtick-quoted `` `type` `` discriminator; `config` mirrors `config`
 *  directly), kept in `com.helio.domain.shapes` rather than reusing the API DTO so domain code
 *  never imports `com.helio.api.protocols` (HEL-391 design.md Decision 1).
 *
 *  A service or test-only 1:1 mapping (`CreatePipelineStepRequest(exp.kind, exp.config)`) is what
 *  proves an expansion is a valid ordinary step create-payload — see `PipelineStepConfigCodec.decode`.
 *
 *  @param kind   the target step's discriminator, e.g. `"select"` — matches a
 *                `com.helio.domain.PipelineStep.Registry` key
 *  @param config the target step's typed config, already shaped as the step kind's canonical
 *                JSON object (e.g. `SelectConfig(...).toJson.asJsObject`)
 */
final case class ShapeStepExpansion(kind: String, config: JsObject)
