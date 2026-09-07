package com.helio.domain.model

import java.time.Instant

final case class ConnectorId(value: String) extends AnyVal

/** A saved, reusable, owner-scoped credentialed host (HEL-821) -- base URL/host +
 *  auth material -- that many data sources can later reference (HEL-822) instead
 *  of each source re-entering its own copy of a credential.
 *
 *  Reuses [[DataSourceKind]]'s vocabulary for `kind` rather than inventing a
 *  parallel enum (`rest_api` first; see design.md).
 *
 *  `credentialId` references a `connector_credentials` row (V92, HEL-536) by id
 *  only -- this type carries no ciphertext or plaintext field, structurally
 *  identical in spirit to [[ConnectorCredentialMeta]]. The credential value is
 *  never part of this domain type; it lives only in `ConnectorCredentialRepository`,
 *  reached exclusively via `credentialId`.
 *
 *  `config` holds kind-specific, non-secret extras only (e.g. SQL's port/database
 *  name) -- see design.md Decision 1 for why the narrower, mostly-queryable
 *  Connector surface gets real columns for name/kind/baseUrl instead of folding
 *  everything into one opaque blob the way `data_sources.config` does.
 *
 *  `credentialId` is `Option` (HEL-955 design.md D1): pendingness is the absence of a
 *  credential, not a status column. `isPending` is `credentialId.isEmpty`. An `authType: "none"`
 *  Connector still has a real credential row holding an encrypted empty string
 *  (`ImplicitConnectorConfig`) -- pending is genuinely *no row*, never conflated with no-auth.
 *
 *  `completedAt`/`completedBy` (HEL-955 design.md D10) record the owner-visible completion
 *  signal, independent of `connector_completion_tokens.consumed_at` (that row is cascaded on
 *  delete). `completedBy` is the authenticated principal, or the literal `"anonymous"`. */
final case class Connector(
    id: ConnectorId,
    ownerId: UserId,
    name: String,
    kind: String,
    baseUrl: String,
    config: String, // raw JSON text, mirrors DataSourceRepository's jsonbStringType convention
    credentialId: Option[ConnectorCredentialId],
    createdAt: Instant,
    updatedAt: Instant,
    completedAt: Option[Instant] = None,
    completedBy: Option[String] = None
) {
  def isPending: Boolean = credentialId.isEmpty
}
