## REMOVED Requirements

### Requirement: GET /api/types returns only the authenticated user's data types
**Reason**: DataType ACL no longer applies; Outputs inherit their pipeline's sharing-aware ACL (see outputs-model).
**Migration**: Callers use the Output/pipeline ACL path instead of per-type ownership checks.

### Requirement: GET /api/types/:id enforces ownership
**Reason**: DataType ACL no longer applies; Outputs inherit their pipeline's sharing-aware ACL (see outputs-model).
**Migration**: Callers use the Output/pipeline ACL path instead of per-type ownership checks.

### Requirement: PATCH /api/types/:id enforces ownership
**Reason**: DataType ACL no longer applies; Outputs inherit their pipeline's sharing-aware ACL (see outputs-model).
**Migration**: Callers use the Output/pipeline ACL path instead of per-type ownership checks.

### Requirement: DELETE /api/types/:id enforces ownership
**Reason**: DataType ACL no longer applies; Outputs inherit their pipeline's sharing-aware ACL (see outputs-model).
**Migration**: Callers use the Output/pipeline ACL path instead of per-type ownership checks.

### Requirement: POST /api/data-sources sets owner_id on the created DataType
**Reason**: DataType ACL no longer applies; Outputs inherit their pipeline's sharing-aware ACL (see outputs-model).
**Migration**: Callers use the Output/pipeline ACL path instead of per-type ownership checks.

### Requirement: Panels with a cross-user type binding are treated as unbound on read
**Reason**: DataType ACL no longer applies; Outputs inherit their pipeline's sharing-aware ACL (see outputs-model).
**Migration**: Callers use the Output/pipeline ACL path instead of per-type ownership checks.

