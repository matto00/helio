# HEL-1389: Output editor clobbers stored config on save (always writes layout "grid"/sort "asc"; can't clear columnOrder/label/unit; keeps stale fieldMapping.annotation)

## Description

origin_kind: followup
origin_ticket: HEL-1313

Found by HEL-1313's evaluator/skeptic (verify each):

* Every save writes collection `layout: "grid"` and timeline `sort: "asc"`, overwriting stored values the editor didn't change.
* The editor can't clear table `columnOrder` or metric `label`/`unit` (empty input means "keep").
* A stale `fieldMapping.annotation` survives saves after the annotation field is removed.

## Acceptance criteria

* A save sends only fields the user changed, or an explicit clear (null) for fields they emptied; untouched stored keys are preserved byte-for-byte.
* Red-first tests per bullet.
