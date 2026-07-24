package com.helio.services

/** Declares one secret-holding field on a connector's wire-payload type `Config` — `get` reports
 *  whether the field currently carries a value worth masking (the SQL/REST asymmetry described on
 *  `SecretRedaction.redact` lives entirely in `get`'s implementation, not here), and `set` writes a
 *  new (masked) value back. See `SqlSourceConfigPayload`/`RestApiConfigPayload`'s companion objects
 *  in `DataSourceProtocol` (HEL-460) for the concrete instances. */
final case class SecretField[Config](
    name: String,
    get:  Config => Option[String],
    set:  (Config, String) => Config
)

/** The "declare once" surface a connector's wire-payload type provides via a single implicit
 *  instance in its own companion object — see design.md Decision 4 for why these instances live
 *  per-payload-type rather than in a centralized registry here. */
final case class HasSecrets[Config](fields: Set[SecretField[Config]])

/** Masking strategy used by `SecretRedaction.redact`. `InlineSecretBackend` is the only concrete
 *  implementation today — HEL-536 owns every non-inline backend (GCP Secret Manager references,
 *  envelope encryption) and will add its own `SecretBackend` implementation behind this interface
 *  without reshaping `SecretRedaction.redact`'s call sites. */
trait SecretBackend {
  def mask(rawValue: String): String
}

/** Today's (and HEL-460's only) `SecretBackend`: replaces any present secret value with the literal
 *  `"***"`, reproducing the redaction behavior that lived inline in `DataSourceProtocol` before this
 *  seam existed. HEL-536 owns future non-inline backends (secret-manager references, envelope
 *  encryption) — this object is not the place to add them. */
object InlineSecretBackend extends SecretBackend {
  override def mask(rawValue: String): String = "***"
}

/** Applies a `HasSecrets[Config]` declaration to a config value, masking every declared field that
 *  is currently present. This is the one seam every connector's redaction path funnels through —
 *  see `Connector.scala`'s `'''Secret redaction'''` doc block. */
object SecretRedaction {

  /** For each `SecretField` in `hs.fields`, replaces the field's value with `backend.mask(value)`
   *  when `field.get(config)` returns `Some(value)`; leaves the config unchanged for that field when
   *  `get` returns `None`. Fields not covered by a `SecretField` declaration are never touched.
   *
   *  `get`/`set` carry the field-specific presence logic — e.g. SQL's `password` field treats an
   *  empty string as absent (no spurious masking of an unset password), while REST's `auth.token`/
   *  `auth.value` fields are masked whenever `Some(_)`, empty string or not. `redact` itself applies
   *  no emptiness rule of its own; it only reacts to `Some`/`None`. */
  def redact[Config](config: Config, backend: SecretBackend = InlineSecretBackend)(implicit
      hs: HasSecrets[Config]
  ): Config =
    hs.fields.foldLeft(config) { (acc, field) =>
      field.get(acc) match {
        case Some(value) => field.set(acc, backend.mask(value))
        case None        => acc
      }
    }
}
