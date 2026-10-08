package com.helio.domain.model

import com.helio.domain.panels._
import spray.json.JsValue

/** Panel ADT (CS2c-3b cycle 1).
 *
 *  Each panel kind is a self-contained module under [[com.helio.domain.panels]]
 *  that owns:
 *
 *    - its typed `*Config` case class (the per-subtype non-common shape)
 *    - the `*Panel` case class implementing the polymorphic trait methods
 *    - the JSON codec for its config (tolerant read + canonical write)
 *    - a [[Panel.Companion]] entry registered with [[Panel.Registry]]
 *
 *  Replaces the pre-CS2c-3b wide-flat `Panel` case class that carried 8
 *  nullable per-subtype fields (`typeId`, `fieldMapping`, `content`,
 *  `imageUrl`, `imageFit`, `dividerOrientation`, `dividerWeight`,
 *  `dividerColor`). The typed ADT eliminates the nullable-field guessing
 *  at every call site.
 *
 *  The trait is intentionally NOT `sealed`: Scala 2 constrains sealed-trait
 *  subclasses to the same compilation unit, which would defeat the per-file
 *  refactor (the CS2c-3a cycle-3 lesson). [[Panel.Registry]] is the source
 *  of truth for [[PanelKind.All]], [[PanelKind.parseKind]] and
 *  [[Panel.companionFor]] only: the codec, service, persistence, JSON-schema,
 *  helio-mcp and frontend layers each enumerate kinds by hand (see
 *  [[PanelKind.All]] for that drift surface).
 *  The kind-set parity test in `PanelSpec` pins the registry's key set; it
 *  does not detect a missed hand-enumerated site.
 *
 *  Wire shape (cycle 1, unchanged): the existing wide-flat JSON shape with
 *  nullable per-subtype fields at the panel root is preserved by
 *  `PanelResponse.fromDomain` pattern-matching the subtype back to flat
 *  fields. Cycle 1 lands the structural domain win without forcing a
 *  coordinated frontend / schema / snapshot wire break; CS2c-3c rewrites
 *  `PanelResponse.fromDomain` for the `config`-collapse wire shape.
 *
 *  DB shape: `PanelRepository.rowToDomain` delegates to
 *  `PanelRowMapper.rowToDomain`, which dispatches on `panels.kind` with a
 *  hand-written match — NOT via the registry — and silently falls back to
 *  `OutputPanel` for an unrecognised kind. */
trait Panel {

  // ── Common identity / metadata fields (every panel subtype carries these) ──

  def id: PanelId
  def dashboardId: DashboardId
  def title: String
  def meta: ResourceMeta
  def appearance: PanelAppearance
  def ownerId: UserId


  /** Stable discriminator string. Always equals the subtype's `Kind` constant. */
  def kind: String

  /** Per-subtype config-shape validation. Returns `Left(message)` for invalid
   *  combinations (e.g. `ImagePanel` with empty `imageUrl`, `DividerPanel` with
   *  `weight <= 0`); subtypes without invariants return `Right(())`.
   *
   *  Cycle 1 wires this onto the trait but does NOT yet promote it to a hard
   *  patch-time gate — the cycle-1 wire shape is still permissive (matches
   *  pre-CS2c-3b behaviour). CS2c-3c may tighten this once clients send
   *  typed `config` payloads. */
  def validateConfig: Either[String, Unit]
}

object Panel {

  /** Per-kind registry entry. Each panel file exports one of these via its
   *  companion object; the [[Registry]] below assembles them. */
  trait Companion {

    /** Stable kind discriminator string. */
    def kind: String

    /** Decode a JsValue (typed-config payload — cycle-1 path) into the
     *  per-subtype `*Config`. Wired for cycle 1's per-subtype JSON
     *  format and CS2c-3c's wire-shape collapse alike. */
    def readConfigFromWire(json: JsValue): Any

    /** Encode a per-subtype config to JsValue for the wire. */
    def writeConfigToWire(config: Any): JsValue
  }

  /** Registry of every panel kind (kind string → [[Companion]]). The source
   *  of truth for [[PanelKind.All]], [[PanelKind.parseKind]] and
   *  [[companionFor]] only — no codec, repo, service or snapshot dispatcher
   *  dispatches through this Map (`PanelConfigCodec` reads its key set only
   *  for an error message). Adding a kind means a new
   *  `panels/<Kind>Panel.scala` file, one line here, AND every hand-enumerated
   *  site described on [[PanelKind.All]]. */
  val Registry: Map[String, Companion] = Map(
    TextPanel.Kind       -> TextPanel.companion,
    MarkdownPanel.Kind   -> MarkdownPanel.companion,
    ImagePanel.Kind      -> ImagePanel.companion,
    DividerPanel.Kind    -> DividerPanel.companion,
    OutputPanel.Kind     -> OutputPanel.companion,
    FormPanel.Kind       -> FormPanel.companion
  )

  /** Look up a kind's companion, or `Left` with a descriptive error. */
  def companionFor(kind: String): Either[String, Companion] =
    Registry.get(kind) match {
      case Some(c) => Right(c)
      case None    =>
        Left(s"Unknown panel type: '$kind'. Valid values: ${Registry.keySet.toSeq.sorted.mkString(", ")}")
    }

}

/** The panel-type discriminator strings. Constants here are exported by
 *  each panel file (as `<Kind>Panel.Kind`); [[All]] is derived from the
 *  registry so this allow-list cannot drift from the registered kinds. It
 *  is not the only list: `PanelType` (model.scala) and the other sites
 *  described on [[All]] enumerate kinds by hand. */
object PanelKind {
  val Text: String       = TextPanel.Kind
  val Markdown: String   = MarkdownPanel.Kind
  val Image: String      = ImagePanel.Kind
  val Divider: String    = DividerPanel.Kind
  val Output: String     = OutputPanel.Kind
  val Form: String       = FormPanel.Kind

  val Default: String = Output

  /** Registry-derived allow-list: the source of truth for [[parseKind]] and
   *  this set ONLY. Adding a kind also requires hand-enumerating many further
   *  sites — `PanelType` (model.scala, incl. its "Valid values" literal),
   *  `PanelConfigCodec`, `PanelServiceHelpers.buildNewPanel`, `PanelRowMapper`,
   *  `PanelRepository`'s config columns, `DashboardSnapshotRepository`,
   *  `ProposalPanelSupport`, `AssistantProposalToolSchemas`, `schemas/panels/`
   *  and `schemas/dashboards/dashboard-proposal.schema.json`, helio-mcp, and
   *  the frontend kind unions and if-chains — plus a migration that drops and
   *  re-adds `panels_kind_check` (precedent: V108). The documented list is the
   *  "Drift surface for a new panel kind" paragraph in §2 of
   *  docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md.
   *  That list is a dated snapshot: re-derive from the tree, e.g.
   *  `git grep -l -i divider -- backend/src/main frontend/src helio-mcp/src schemas`
   *  (unquoted: backend sites match on `DividerPanel.Kind`, not the string).
   *  Known gates: `PanelSpec` pins the registry key set, and
   *  scripts/check-schema-drift.mjs checks several schema / helio-mcp enums
   *  against `PanelType.fromString`; many other sites fall through silently
   *  (e.g. `PanelRowMapper.rowToDomain`'s `case _ =>` → `OutputPanel`). */
  def All: Set[String] = Panel.Registry.keySet

  def parseKind(s: String): Either[String, String] =
    if (All.contains(s)) Right(s)
    else Left(s"Unknown panel type: '$s'. Valid values: ${All.toSeq.sorted.mkString(", ")}")
}
