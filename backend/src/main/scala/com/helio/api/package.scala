package com.helio

/** Re-exports for the per-domain protocol case classes/companions that
 *  used to live directly in `com.helio.api`. Call sites that do
 *  `import com.helio.api._` continue to see the request/response types
 *  even though their authoritative definitions now live under
 *  `com.helio.api.protocols`. */
package object api {
  // Resource / shared
  type ResourceMetaResponse = protocols.ResourceMetaResponse
  val ResourceMetaResponse: protocols.ResourceMetaResponse.type = protocols.ResourceMetaResponse
  type ErrorResponse = protocols.ErrorResponse
  val ErrorResponse: protocols.ErrorResponse.type = protocols.ErrorResponse
  type HealthResponse = protocols.HealthResponse
  val HealthResponse: protocols.HealthResponse.type = protocols.HealthResponse

  // Auth
  type RegisterRequest = protocols.RegisterRequest
  val RegisterRequest: protocols.RegisterRequest.type = protocols.RegisterRequest
  type LoginRequest = protocols.LoginRequest
  val LoginRequest: protocols.LoginRequest.type = protocols.LoginRequest
  type UserPreferences = protocols.UserPreferences
  val UserPreferences: protocols.UserPreferences.type = protocols.UserPreferences
  type UserResponse = protocols.UserResponse
  val UserResponse: protocols.UserResponse.type = protocols.UserResponse
  type AuthResponse = protocols.AuthResponse
  val AuthResponse: protocols.AuthResponse.type = protocols.AuthResponse
  type GoogleProfile = protocols.GoogleProfile
  val GoogleProfile: protocols.GoogleProfile.type = protocols.GoogleProfile
  type UpdateUserPreferenceRequest = protocols.UpdateUserPreferenceRequest
  val UpdateUserPreferenceRequest: protocols.UpdateUserPreferenceRequest.type = protocols.UpdateUserPreferenceRequest

  // Dashboard
  type DashboardAppearancePayload = protocols.DashboardAppearancePayload
  val DashboardAppearancePayload: protocols.DashboardAppearancePayload.type = protocols.DashboardAppearancePayload
  type DashboardLayoutItemPayload = protocols.DashboardLayoutItemPayload
  val DashboardLayoutItemPayload: protocols.DashboardLayoutItemPayload.type = protocols.DashboardLayoutItemPayload
  type DashboardLayoutPayload = protocols.DashboardLayoutPayload
  val DashboardLayoutPayload: protocols.DashboardLayoutPayload.type = protocols.DashboardLayoutPayload
  type DashboardAppearanceResponse = protocols.DashboardAppearanceResponse
  val DashboardAppearanceResponse: protocols.DashboardAppearanceResponse.type = protocols.DashboardAppearanceResponse
  type DashboardLayoutItemResponse = protocols.DashboardLayoutItemResponse
  val DashboardLayoutItemResponse: protocols.DashboardLayoutItemResponse.type = protocols.DashboardLayoutItemResponse
  type DashboardLayoutResponse = protocols.DashboardLayoutResponse
  val DashboardLayoutResponse: protocols.DashboardLayoutResponse.type = protocols.DashboardLayoutResponse
  type DashboardResponse = protocols.DashboardResponse
  val DashboardResponse: protocols.DashboardResponse.type = protocols.DashboardResponse
  type DashboardsResponse = protocols.DashboardsResponse
  val DashboardsResponse: protocols.DashboardsResponse.type = protocols.DashboardsResponse
  type DuplicateDashboardResponse = protocols.DuplicateDashboardResponse
  val DuplicateDashboardResponse: protocols.DuplicateDashboardResponse.type = protocols.DuplicateDashboardResponse
  type CreateDashboardRequest = protocols.CreateDashboardRequest
  val CreateDashboardRequest: protocols.CreateDashboardRequest.type = protocols.CreateDashboardRequest
  type UpdateDashboardRequest = protocols.UpdateDashboardRequest
  val UpdateDashboardRequest: protocols.UpdateDashboardRequest.type = protocols.UpdateDashboardRequest
  type UpdateDashboardBatchRequest = protocols.UpdateDashboardBatchRequest
  val UpdateDashboardBatchRequest: protocols.UpdateDashboardBatchRequest.type = protocols.UpdateDashboardBatchRequest
  type DashboardSnapshotPanelEntry = protocols.DashboardSnapshotPanelEntry
  val DashboardSnapshotPanelEntry: protocols.DashboardSnapshotPanelEntry.type = protocols.DashboardSnapshotPanelEntry
  type DashboardSnapshotDashboardEntry = protocols.DashboardSnapshotDashboardEntry
  val DashboardSnapshotDashboardEntry: protocols.DashboardSnapshotDashboardEntry.type = protocols.DashboardSnapshotDashboardEntry
  type DashboardSnapshotPayload = protocols.DashboardSnapshotPayload
  val DashboardSnapshotPayload: protocols.DashboardSnapshotPayload.type = protocols.DashboardSnapshotPayload

  // Panel
  type PanelAppearancePayload = protocols.PanelAppearancePayload
  val PanelAppearancePayload: protocols.PanelAppearancePayload.type = protocols.PanelAppearancePayload
  type PanelAppearanceResponse = protocols.PanelAppearanceResponse
  val PanelAppearanceResponse: protocols.PanelAppearanceResponse.type = protocols.PanelAppearanceResponse
  type PanelResponse = protocols.PanelResponse
  val PanelResponse: protocols.PanelResponse.type = protocols.PanelResponse
  type PanelsResponse = protocols.PanelsResponse
  val PanelsResponse: protocols.PanelsResponse.type = protocols.PanelsResponse
  type CreatePanelRequest = protocols.CreatePanelRequest
  val CreatePanelRequest: protocols.CreatePanelRequest.type = protocols.CreatePanelRequest
  type UpdatePanelRequest = protocols.UpdatePanelRequest
  val UpdatePanelRequest: protocols.UpdatePanelRequest.type = protocols.UpdatePanelRequest
  type PanelBatchItem = protocols.PanelBatchItem
  val PanelBatchItem: protocols.PanelBatchItem.type = protocols.PanelBatchItem
  type UpdatePanelsBatchRequest = protocols.UpdatePanelsBatchRequest
  val UpdatePanelsBatchRequest: protocols.UpdatePanelsBatchRequest.type = protocols.UpdatePanelsBatchRequest
  type UpdatePanelsBatchResponse = protocols.UpdatePanelsBatchResponse
  val UpdatePanelsBatchResponse: protocols.UpdatePanelsBatchResponse.type = protocols.UpdatePanelsBatchResponse

  // DataType
  type DataTypeResponse = protocols.DataTypeResponse
  val DataTypeResponse: protocols.DataTypeResponse.type = protocols.DataTypeResponse
  type DataTypesResponse = protocols.DataTypesResponse
  val DataTypesResponse: protocols.DataTypesResponse.type = protocols.DataTypesResponse
  type DataFieldPayload = protocols.DataFieldPayload
  val DataFieldPayload: protocols.DataFieldPayload.type = protocols.DataFieldPayload
  type ComputedFieldPayload = protocols.ComputedFieldPayload
  val ComputedFieldPayload: protocols.ComputedFieldPayload.type = protocols.ComputedFieldPayload
  type UpdateDataTypeRequest = protocols.UpdateDataTypeRequest
  val UpdateDataTypeRequest: protocols.UpdateDataTypeRequest.type = protocols.UpdateDataTypeRequest
  type ValidateExpressionResponse = protocols.ValidateExpressionResponse
  val ValidateExpressionResponse: protocols.ValidateExpressionResponse.type = protocols.ValidateExpressionResponse
  type InferredFieldResponse = protocols.InferredFieldResponse
  val InferredFieldResponse: protocols.InferredFieldResponse.type = protocols.InferredFieldResponse
  type InferredSchemaResponse = protocols.InferredSchemaResponse
  val InferredSchemaResponse: protocols.InferredSchemaResponse.type = protocols.InferredSchemaResponse
  type SchemaFieldResponse = protocols.SchemaFieldResponse
  val SchemaFieldResponse: protocols.SchemaFieldResponse.type = protocols.SchemaFieldResponse
  type DataTypeRowsResponse = protocols.DataTypeRowsResponse
  val DataTypeRowsResponse: protocols.DataTypeRowsResponse.type = protocols.DataTypeRowsResponse

  // DataSource
  type DataSourceResponse = protocols.DataSourceResponse
  val DataSourceResponse: protocols.DataSourceResponse.type = protocols.DataSourceResponse
  type DataSourcesResponse = protocols.DataSourcesResponse
  val DataSourcesResponse: protocols.DataSourcesResponse.type = protocols.DataSourcesResponse
  type UpdateDataSourceRequest = protocols.UpdateDataSourceRequest
  val UpdateDataSourceRequest: protocols.UpdateDataSourceRequest.type = protocols.UpdateDataSourceRequest
  type CsvPreviewResponse = protocols.CsvPreviewResponse
  val CsvPreviewResponse: protocols.CsvPreviewResponse.type = protocols.CsvPreviewResponse
  type PreviewSourceResponse = protocols.PreviewSourceResponse
  val PreviewSourceResponse: protocols.PreviewSourceResponse.type = protocols.PreviewSourceResponse
  type SqlSourceConfigPayload = protocols.SqlSourceConfigPayload
  val SqlSourceConfigPayload: protocols.SqlSourceConfigPayload.type = protocols.SqlSourceConfigPayload
  type SqlCreateSourceRequest = protocols.SqlCreateSourceRequest
  val SqlCreateSourceRequest: protocols.SqlCreateSourceRequest.type = protocols.SqlCreateSourceRequest
  type SqlInferRequest = protocols.SqlInferRequest
  val SqlInferRequest: protocols.SqlInferRequest.type = protocols.SqlInferRequest
  type RestApiConfigPayload = protocols.RestApiConfigPayload
  val RestApiConfigPayload: protocols.RestApiConfigPayload.type = protocols.RestApiConfigPayload
  type FieldOverridePayload = protocols.FieldOverridePayload
  val FieldOverridePayload: protocols.FieldOverridePayload.type = protocols.FieldOverridePayload
  type CreateSourceRequest = protocols.CreateSourceRequest
  val CreateSourceRequest: protocols.CreateSourceRequest.type = protocols.CreateSourceRequest
  type CreateSourceResponse = protocols.CreateSourceResponse
  val CreateSourceResponse: protocols.CreateSourceResponse.type = protocols.CreateSourceResponse
  type StaticColumnPayload = protocols.StaticColumnPayload
  val StaticColumnPayload: protocols.StaticColumnPayload.type = protocols.StaticColumnPayload
  type StaticDataPayload = protocols.StaticDataPayload
  val StaticDataPayload: protocols.StaticDataPayload.type = protocols.StaticDataPayload
  type StaticDataSourceRequest = protocols.StaticDataSourceRequest
  val StaticDataSourceRequest: protocols.StaticDataSourceRequest.type = protocols.StaticDataSourceRequest

  // Pipeline
  type CreatePipelineRequest = protocols.CreatePipelineRequest
  val CreatePipelineRequest: protocols.CreatePipelineRequest.type = protocols.CreatePipelineRequest
  type UpdatePipelineRequest = protocols.UpdatePipelineRequest
  val UpdatePipelineRequest: protocols.UpdatePipelineRequest.type = protocols.UpdatePipelineRequest
  type PipelineSummaryResponse = protocols.PipelineSummaryResponse
  val PipelineSummaryResponse: protocols.PipelineSummaryResponse.type = protocols.PipelineSummaryResponse
  type CreatePipelineStepRequest = protocols.CreatePipelineStepRequest
  val CreatePipelineStepRequest: protocols.CreatePipelineStepRequest.type = protocols.CreatePipelineStepRequest
  type UpdatePipelineStepRequest = protocols.UpdatePipelineStepRequest
  val UpdatePipelineStepRequest: protocols.UpdatePipelineStepRequest.type = protocols.UpdatePipelineStepRequest
  type PipelineStepResponse = protocols.PipelineStepResponse
  val PipelineStepResponse: protocols.PipelineStepResponse.type = protocols.PipelineStepResponse
  type AnalyzeStepResponse = protocols.AnalyzeStepResponse
  // AnalyzeStepResponse is a sealed trait (no companion object); per-subtype
  // case classes (RenameAnalyzeStepResponse, etc.) are accessed directly from
  // protocols where needed.
  type PipelineAnalyzeResponse = protocols.PipelineAnalyzeResponse
  val PipelineAnalyzeResponse: protocols.PipelineAnalyzeResponse.type = protocols.PipelineAnalyzeResponse
  type RunSubmitResponse = protocols.RunSubmitResponse
  val RunSubmitResponse: protocols.RunSubmitResponse.type = protocols.RunSubmitResponse
  type RunStatusResponse = protocols.RunStatusResponse
  val RunStatusResponse: protocols.RunStatusResponse.type = protocols.RunStatusResponse
  type PipelineRunRecord = protocols.PipelineRunRecord
  val PipelineRunRecord: protocols.PipelineRunRecord.type = protocols.PipelineRunRecord
  type RunResultResponse = protocols.RunResultResponse
  val RunResultResponse: protocols.RunResultResponse.type = protocols.RunResultResponse

  // Permission
  type GrantPermissionRequest = protocols.GrantPermissionRequest
  val GrantPermissionRequest: protocols.GrantPermissionRequest.type = protocols.GrantPermissionRequest
  type PermissionResponse = protocols.PermissionResponse
  val PermissionResponse: protocols.PermissionResponse.type = protocols.PermissionResponse
  type PermissionsResponse = protocols.PermissionsResponse
  val PermissionsResponse: protocols.PermissionsResponse.type = protocols.PermissionsResponse
}
