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
 *  refactor (the CS2c-3a cycle-3 lesson). Discipline is enforced via
 *  [[Panel.Registry]] — only kinds registered there round-trip through the
 *  protocol / repo / service. Adding an 8th panel kind without updating
 *  the registry is caught by the kind-set parity test in `PanelSpec`.
 *
 *  Wire shape (cycle 1, unchanged): the existing wide-flat JSON shape with
 *  nullable per-subtype fields at the panel root is preserved by
 *  `PanelResponse.fromDomain` pattern-matching the subtype back to flat
 *  fields. Cycle 1 lands the structural domain win without forcing a
 *  coordinated frontend / schema / snapshot wire break; CS2c-3c rewrites
 *  `PanelResponse.fromDomain` for the `config`-collapse wire shape.
 *
 *  DB shape (unchanged): the `panels` table preserves all 8 per-subtype
 *  nullable columns; `PanelRepository.rowToDomain` dispatches on
 *  `panels.type` → typed subtype via the registry. */
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

  /** Registry of every panel kind. Single source of truth — every
   *  protocol / repo / service / snapshot dispatcher derives from this Map.
   *  Adding an 8th panel kind means dropping in one `panels/<Kind>Panel.scala`
   *  file and adding one line here. */
  val Registry: Map[String, Companion] = Map(
    TextPanel.Kind       -> TextPanel.companion,
    MarkdownPanel.Kind   -> MarkdownPanel.companion,
    ImagePanel.Kind      -> ImagePanel.companion,
    DividerPanel.Kind    -> DividerPanel.companion,
    OutputPanel.Kind     -> OutputPanel.companion
  )

  /** Look up a kind's companion, or `Left` with a descriptive error. */
  def companionFor(kind: String): Either[String, Companion] =
    Registry.get(kind) match {
      case Some(c) => Right(c)
      case None    =>
        Left(s"Unknown panel type: '$kind'. Valid values: ${Registry.keySet.toSeq.sorted.mkString(", ")}")
    }

}

/** Source of truth for the panel-type discriminator string. Constants here
 *  are exported by each panel file (as `<Kind>Panel.Kind`); [[All]] is
 *  derived from the registry so the allow-list cannot drift from the
 *  actual set of registered kinds. */
object PanelKind {
  val Text: String       = TextPanel.Kind
  val Markdown: String   = MarkdownPanel.Kind
  val Image: String      = ImagePanel.Kind
  val Divider: String    = DividerPanel.Kind
  val Output: String     = OutputPanel.Kind

  val Default: String = Output

  /** Registry-derived allow-list. After cycle 1 no consumer enumerates these
   *  manually — adding a new kind only requires updating [[Panel.Registry]]. */
  def All: Set[String] = Panel.Registry.keySet

  def parseKind(s: String): Either[String, String] =
    if (All.contains(s)) Right(s)
    else Left(s"Unknown panel type: '$s'. Valid values: ${All.toSeq.sorted.mkString(", ")}")
}
