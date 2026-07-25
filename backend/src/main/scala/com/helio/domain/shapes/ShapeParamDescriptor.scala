package com.helio.domain.shapes

/** Descriptive metadata for one of a [[PipelineShape]]'s `expand` params — tells a caller (frontend,
 *  MCP tool, agent) what a shape needs before it builds a call, mirroring
 *  `com.helio.domain.ConnectorFieldDescriptor`'s "descriptors only, never values" role
 *  (HEL-391 design.md Decision 3). Not a validating JSON Schema document — actual validation of a
 *  caller-supplied `params: JsObject` happens inside `expand` itself.
 *
 *  @param name        the param's wire key inside `expand`'s `params` object, e.g. `"fields"`
 *  @param label       human-readable label, e.g. `"Fields"`
 *  @param dataType    coarse descriptive type string for the param's expected shape, e.g.
 *                     `"string[]"`, `"string"`, `"integer"` — descriptive only, not a validator
 *  @param required    whether `expand` fails with `Left` when this param is absent
 *  @param description human-readable explanation of what the param controls
 */
final case class ShapeParamDescriptor(
    name: String,
    label: String,
    dataType: String,
    required: Boolean,
    description: String
)
