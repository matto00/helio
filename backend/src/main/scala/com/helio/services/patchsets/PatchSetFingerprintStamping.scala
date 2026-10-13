package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.{PatchSet, PatchSetPreviewResponse}

/** Model output never carries fingerprints (HEL-1458) or a `proposalId` (HEL-1522): they are stripped from a model-produced patch set before it
 *  is previewed, and the server stamps the ones its own preview computed. */
private[services] object PatchSetFingerprintStamping {

  /** A model-invented fingerprint on a `create` would otherwise trip the create+fingerprint 400. */
  def strip(patchSet: PatchSet): PatchSet =
    patchSet.copy(edits = patchSet.edits.map(edit => edit.copy(target = edit.target.copy(fingerprint = None))), proposalId = None)

  /** Copies each preview entry's fingerprint onto the edit at the same index. */
  def stamp(patchSet: PatchSet, preview: PatchSetPreviewResponse): PatchSet = {
    val byIndex = preview.edits.map(entry => entry.index -> entry.fingerprint).toMap
    patchSet.copy(edits = patchSet.edits.zipWithIndex.map { case (edit, index) =>
      edit.copy(target = edit.target.copy(fingerprint = byIndex.getOrElse(index, None)))
    })
  }
}
