package com.helio

/** Re-exports for the per-domain protocol case classes/companions that
 *  used to live directly in `com.helio.api`. Call sites that do
 *  `import com.helio.api._` continue to see the request/response types
 *  even though their authoritative definitions now live under
 *  `com.helio.api.protocols`. */
package object api {
  type ResourceMetaResponse = protocols.ResourceMetaResponse
  val ResourceMetaResponse: protocols.ResourceMetaResponse.type = protocols.ResourceMetaResponse
  type ErrorResponse = protocols.ErrorResponse
  val ErrorResponse: protocols.ErrorResponse.type = protocols.ErrorResponse
  type HealthResponse = protocols.HealthResponse
  val HealthResponse: protocols.HealthResponse.type = protocols.HealthResponse

  type RegisterRequest = protocols.auth.RegisterRequest
  val RegisterRequest: protocols.auth.RegisterRequest.type = protocols.auth.RegisterRequest
  type LoginRequest = protocols.auth.LoginRequest
  val LoginRequest: protocols.auth.LoginRequest.type = protocols.auth.LoginRequest
  type UserPreferences = protocols.auth.UserPreferences
  val UserPreferences: protocols.auth.UserPreferences.type = protocols.auth.UserPreferences
  type UserResponse = protocols.auth.UserResponse
  val UserResponse: protocols.auth.UserResponse.type = protocols.auth.UserResponse
  type AuthResponse = protocols.auth.AuthResponse
  val AuthResponse: protocols.auth.AuthResponse.type = protocols.auth.AuthResponse
  type GoogleProfile = protocols.auth.GoogleProfile
  val GoogleProfile: protocols.auth.GoogleProfile.type = protocols.auth.GoogleProfile
  type UpdateUserPreferenceRequest = protocols.auth.UpdateUserPreferenceRequest
  val UpdateUserPreferenceRequest: protocols.auth.UpdateUserPreferenceRequest.type = protocols.auth.UpdateUserPreferenceRequest

  type MfaStatusResponse = protocols.auth.MfaStatusResponse
  val MfaStatusResponse: protocols.auth.MfaStatusResponse.type = protocols.auth.MfaStatusResponse
  type MfaEnrollResponse = protocols.auth.MfaEnrollResponse
  val MfaEnrollResponse: protocols.auth.MfaEnrollResponse.type = protocols.auth.MfaEnrollResponse
  type MfaConfirmRequest = protocols.auth.MfaConfirmRequest
  val MfaConfirmRequest: protocols.auth.MfaConfirmRequest.type = protocols.auth.MfaConfirmRequest
  type MfaBackupCodesResponse = protocols.auth.MfaBackupCodesResponse
  val MfaBackupCodesResponse: protocols.auth.MfaBackupCodesResponse.type = protocols.auth.MfaBackupCodesResponse
  type MfaReauthRequest = protocols.auth.MfaReauthRequest
  val MfaReauthRequest: protocols.auth.MfaReauthRequest.type = protocols.auth.MfaReauthRequest
  type MfaVerifyRequest = protocols.auth.MfaVerifyRequest
  val MfaVerifyRequest: protocols.auth.MfaVerifyRequest.type = protocols.auth.MfaVerifyRequest
  type MfaRequiredResponse = protocols.auth.MfaRequiredResponse
  val MfaRequiredResponse: protocols.auth.MfaRequiredResponse.type = protocols.auth.MfaRequiredResponse

  type CreateApiTokenRequest = protocols.auth.CreateApiTokenRequest
  val CreateApiTokenRequest: protocols.auth.CreateApiTokenRequest.type = protocols.auth.CreateApiTokenRequest
  type CreateApiTokenResponse = protocols.auth.CreateApiTokenResponse
  val CreateApiTokenResponse: protocols.auth.CreateApiTokenResponse.type = protocols.auth.CreateApiTokenResponse
  type ApiTokenResponse = protocols.auth.ApiTokenResponse
  val ApiTokenResponse: protocols.auth.ApiTokenResponse.type = protocols.auth.ApiTokenResponse

  type DashboardAppearancePayload = protocols.dashboards.DashboardAppearancePayload
  val DashboardAppearancePayload: protocols.dashboards.DashboardAppearancePayload.type = protocols.dashboards.DashboardAppearancePayload
  type DashboardLayoutItemPayload = protocols.dashboards.DashboardLayoutItemPayload
  val DashboardLayoutItemPayload: protocols.dashboards.DashboardLayoutItemPayload.type = protocols.dashboards.DashboardLayoutItemPayload
  type DashboardLayoutPayload = protocols.dashboards.DashboardLayoutPayload
  val DashboardLayoutPayload: protocols.dashboards.DashboardLayoutPayload.type = protocols.dashboards.DashboardLayoutPayload
  type DashboardAppearanceResponse = protocols.dashboards.DashboardAppearanceResponse
  val DashboardAppearanceResponse: protocols.dashboards.DashboardAppearanceResponse.type = protocols.dashboards.DashboardAppearanceResponse
  type DashboardLayoutItemResponse = protocols.dashboards.DashboardLayoutItemResponse
  val DashboardLayoutItemResponse: protocols.dashboards.DashboardLayoutItemResponse.type = protocols.dashboards.DashboardLayoutItemResponse
  type DashboardLayoutResponse = protocols.dashboards.DashboardLayoutResponse
  val DashboardLayoutResponse: protocols.dashboards.DashboardLayoutResponse.type = protocols.dashboards.DashboardLayoutResponse
  type DashboardResponse = protocols.dashboards.DashboardResponse
  val DashboardResponse: protocols.dashboards.DashboardResponse.type = protocols.dashboards.DashboardResponse
  type DashboardsResponse = protocols.dashboards.DashboardsResponse
  val DashboardsResponse: protocols.dashboards.DashboardsResponse.type = protocols.dashboards.DashboardsResponse
  type DuplicateDashboardResponse = protocols.dashboards.DuplicateDashboardResponse
  val DuplicateDashboardResponse: protocols.dashboards.DuplicateDashboardResponse.type = protocols.dashboards.DuplicateDashboardResponse
  type CreateDashboardRequest = protocols.dashboards.CreateDashboardRequest
  val CreateDashboardRequest: protocols.dashboards.CreateDashboardRequest.type = protocols.dashboards.CreateDashboardRequest
  type UpdateDashboardRequest = protocols.dashboards.UpdateDashboardRequest
  val UpdateDashboardRequest: protocols.dashboards.UpdateDashboardRequest.type = protocols.dashboards.UpdateDashboardRequest
  type UpdateDashboardBatchRequest = protocols.dashboards.UpdateDashboardBatchRequest
  val UpdateDashboardBatchRequest: protocols.dashboards.UpdateDashboardBatchRequest.type = protocols.dashboards.UpdateDashboardBatchRequest
  type DashboardSnapshotPanelEntry = protocols.dashboards.DashboardSnapshotPanelEntry
  val DashboardSnapshotPanelEntry: protocols.dashboards.DashboardSnapshotPanelEntry.type = protocols.dashboards.DashboardSnapshotPanelEntry
  type DashboardSnapshotDashboardEntry = protocols.dashboards.DashboardSnapshotDashboardEntry
  val DashboardSnapshotDashboardEntry: protocols.dashboards.DashboardSnapshotDashboardEntry.type = protocols.dashboards.DashboardSnapshotDashboardEntry
  type DashboardSnapshotPayload = protocols.dashboards.DashboardSnapshotPayload
  val DashboardSnapshotPayload: protocols.dashboards.DashboardSnapshotPayload.type = protocols.dashboards.DashboardSnapshotPayload

  type DashboardProposal = protocols.proposals.DashboardProposal
  val DashboardProposal: protocols.proposals.DashboardProposal.type = protocols.proposals.DashboardProposal
  type ProposalPanel = protocols.proposals.ProposalPanel
  val ProposalPanel: protocols.proposals.ProposalPanel.type = protocols.proposals.ProposalPanel
  type ProposalPanelLayout = protocols.proposals.ProposalPanelLayout
  val ProposalPanelLayout: protocols.proposals.ProposalPanelLayout.type = protocols.proposals.ProposalPanelLayout

  type ReplaceDashboardContentsRequest = protocols.proposals.ReplaceDashboardContentsRequest
  val ReplaceDashboardContentsRequest: protocols.proposals.ReplaceDashboardContentsRequest.type =
    protocols.proposals.ReplaceDashboardContentsRequest

  type AutoLayoutItemPayload = protocols.dashboards.AutoLayoutItemPayload
  val AutoLayoutItemPayload: protocols.dashboards.AutoLayoutItemPayload.type = protocols.dashboards.AutoLayoutItemPayload
  type AutoLayoutRequest = protocols.dashboards.AutoLayoutRequest
  val AutoLayoutRequest: protocols.dashboards.AutoLayoutRequest.type = protocols.dashboards.AutoLayoutRequest

  type PanelAppearancePayload = protocols.panels.PanelAppearancePayload
  val PanelAppearancePayload: protocols.panels.PanelAppearancePayload.type = protocols.panels.PanelAppearancePayload
  type PanelAppearanceResponse = protocols.panels.PanelAppearanceResponse
  val PanelAppearanceResponse: protocols.panels.PanelAppearanceResponse.type = protocols.panels.PanelAppearanceResponse
  type PanelResponse = protocols.panels.PanelResponse
  val PanelResponse: protocols.panels.PanelResponse.type = protocols.panels.PanelResponse
  type PanelLayoutResponse = protocols.panels.PanelLayoutResponse
  val PanelLayoutResponse: protocols.panels.PanelLayoutResponse.type = protocols.panels.PanelLayoutResponse
  type PanelsResponse = protocols.panels.PanelsResponse
  val PanelsResponse: protocols.panels.PanelsResponse.type = protocols.panels.PanelsResponse
  type CreatePanelRequest = protocols.panels.CreatePanelRequest
  val CreatePanelRequest: protocols.panels.CreatePanelRequest.type = protocols.panels.CreatePanelRequest
  type UpdatePanelRequest = protocols.panels.UpdatePanelRequest
  val UpdatePanelRequest: protocols.panels.UpdatePanelRequest.type = protocols.panels.UpdatePanelRequest
  type PanelBatchItem = protocols.panels.PanelBatchItem
  val PanelBatchItem: protocols.panels.PanelBatchItem.type = protocols.panels.PanelBatchItem
  type UpdatePanelsBatchRequest = protocols.panels.UpdatePanelsBatchRequest
  val UpdatePanelsBatchRequest: protocols.panels.UpdatePanelsBatchRequest.type = protocols.panels.UpdatePanelsBatchRequest
  type UpdatePanelsBatchResponse = protocols.panels.UpdatePanelsBatchResponse
  val UpdatePanelsBatchResponse: protocols.panels.UpdatePanelsBatchResponse.type = protocols.panels.UpdatePanelsBatchResponse
  type CreatePanelBatchItem = protocols.panels.CreatePanelBatchItem
  val CreatePanelBatchItem: protocols.panels.CreatePanelBatchItem.type = protocols.panels.CreatePanelBatchItem
  type CreatePanelsBatchRequest = protocols.panels.CreatePanelsBatchRequest
  val CreatePanelsBatchRequest: protocols.panels.CreatePanelsBatchRequest.type = protocols.panels.CreatePanelsBatchRequest
  type CreatePanelsBatchResponse = protocols.panels.CreatePanelsBatchResponse
  val CreatePanelsBatchResponse: protocols.panels.CreatePanelsBatchResponse.type = protocols.panels.CreatePanelsBatchResponse

  // HEL-904 task 4.1: DataTypeResponse/DataTypesResponse/DataFieldPayload/
  // ComputedFieldPayload/UpdateDataTypeRequest/ValidateExpressionResponse
  // aliases removed outright — `DataTypeProtocol` (their home) is deleted;
  // DataTypes no longer exist.
  // HEL-904: InferredFieldResponse/InferredSchemaResponse moved from protocols.pipelines to
  // protocols.sources — see DataSourceProtocol.scala. SchemaFieldResponse stayed in
  // protocols.pipelines (PipelineAnalyzeProtocol.scala) — it's load-bearing for the unrelated
  // pipeline-analyze-step response shapes in that same package.
  type InferredFieldResponse = protocols.sources.InferredFieldResponse
  val InferredFieldResponse: protocols.sources.InferredFieldResponse.type = protocols.sources.InferredFieldResponse
  type InferredSchemaResponse = protocols.sources.InferredSchemaResponse
  val InferredSchemaResponse: protocols.sources.InferredSchemaResponse.type = protocols.sources.InferredSchemaResponse
  type SchemaFieldResponse = protocols.pipelines.SchemaFieldResponse
  val SchemaFieldResponse: protocols.pipelines.SchemaFieldResponse.type = protocols.pipelines.SchemaFieldResponse
  type DataSourceResponse = protocols.sources.DataSourceResponse
  val DataSourceResponse: protocols.sources.DataSourceResponse.type = protocols.sources.DataSourceResponse
  type DataSourceDeleteConflictResponse = protocols.sources.DataSourceDeleteConflictResponse
  val DataSourceDeleteConflictResponse: protocols.sources.DataSourceDeleteConflictResponse.type =
    protocols.sources.DataSourceDeleteConflictResponse
  type DataSourcesResponse = protocols.sources.DataSourcesResponse
  val DataSourcesResponse: protocols.sources.DataSourcesResponse.type = protocols.sources.DataSourcesResponse
  type UpdateDataSourceRequest = protocols.sources.UpdateDataSourceRequest
  val UpdateDataSourceRequest: protocols.sources.UpdateDataSourceRequest.type = protocols.sources.UpdateDataSourceRequest
  type CsvPreviewResponse = protocols.sources.CsvPreviewResponse
  val CsvPreviewResponse: protocols.sources.CsvPreviewResponse.type = protocols.sources.CsvPreviewResponse
  type PreviewSourceResponse = protocols.sources.PreviewSourceResponse
  val PreviewSourceResponse: protocols.sources.PreviewSourceResponse.type = protocols.sources.PreviewSourceResponse
  type SqlSourceConfigPayload = protocols.sources.SqlSourceConfigPayload
  val SqlSourceConfigPayload: protocols.sources.SqlSourceConfigPayload.type = protocols.sources.SqlSourceConfigPayload
  type SqlCreateSourceRequest = protocols.sources.SqlCreateSourceRequest
  val SqlCreateSourceRequest: protocols.sources.SqlCreateSourceRequest.type = protocols.sources.SqlCreateSourceRequest
  type SqlInferRequest = protocols.sources.SqlInferRequest
  val SqlInferRequest: protocols.sources.SqlInferRequest.type = protocols.sources.SqlInferRequest
  type TestConnectionResponse = protocols.sources.TestConnectionResponse
  val TestConnectionResponse: protocols.sources.TestConnectionResponse.type = protocols.sources.TestConnectionResponse
  type RestApiConfigPayload = protocols.sources.RestApiConfigPayload
  val RestApiConfigPayload: protocols.sources.RestApiConfigPayload.type = protocols.sources.RestApiConfigPayload
  type FieldOverridePayload = protocols.sources.FieldOverridePayload
  val FieldOverridePayload: protocols.sources.FieldOverridePayload.type = protocols.sources.FieldOverridePayload
  type CreateSourceRequest = protocols.sources.CreateSourceRequest
  val CreateSourceRequest: protocols.sources.CreateSourceRequest.type = protocols.sources.CreateSourceRequest
  type CreateSourceResponse = protocols.sources.CreateSourceResponse
  val CreateSourceResponse: protocols.sources.CreateSourceResponse.type = protocols.sources.CreateSourceResponse
  type StaticColumnPayload = protocols.sources.StaticColumnPayload
  val StaticColumnPayload: protocols.sources.StaticColumnPayload.type = protocols.sources.StaticColumnPayload
  type StaticDataPayload = protocols.sources.StaticDataPayload
  val StaticDataPayload: protocols.sources.StaticDataPayload.type = protocols.sources.StaticDataPayload
  type StaticDataSourceRequest = protocols.sources.StaticDataSourceRequest
  val StaticDataSourceRequest: protocols.sources.StaticDataSourceRequest.type = protocols.sources.StaticDataSourceRequest
  type CsvSourceUrlConfigPayload = protocols.sources.CsvSourceUrlConfigPayload
  val CsvSourceUrlConfigPayload: protocols.sources.CsvSourceUrlConfigPayload.type = protocols.sources.CsvSourceUrlConfigPayload
  type CsvSourceUrlRequest = protocols.sources.CsvSourceUrlRequest
  val CsvSourceUrlRequest: protocols.sources.CsvSourceUrlRequest.type = protocols.sources.CsvSourceUrlRequest
  type TextSourceConfigPayload = protocols.sources.TextSourceConfigPayload
  val TextSourceConfigPayload: protocols.sources.TextSourceConfigPayload.type = protocols.sources.TextSourceConfigPayload
  type TextSourceUrlConfigPayload = protocols.sources.TextSourceUrlConfigPayload
  val TextSourceUrlConfigPayload: protocols.sources.TextSourceUrlConfigPayload.type = protocols.sources.TextSourceUrlConfigPayload
  type TextSourceUrlRequest = protocols.sources.TextSourceUrlRequest
  val TextSourceUrlRequest: protocols.sources.TextSourceUrlRequest.type = protocols.sources.TextSourceUrlRequest
  type TextSourceResponse = protocols.sources.TextSourceResponse
  val TextSourceResponse: protocols.sources.TextSourceResponse.type = protocols.sources.TextSourceResponse
  type PdfSourceConfigPayload = protocols.sources.PdfSourceConfigPayload
  val PdfSourceConfigPayload: protocols.sources.PdfSourceConfigPayload.type = protocols.sources.PdfSourceConfigPayload
  type PdfSourceUrlConfigPayload = protocols.sources.PdfSourceUrlConfigPayload
  val PdfSourceUrlConfigPayload: protocols.sources.PdfSourceUrlConfigPayload.type = protocols.sources.PdfSourceUrlConfigPayload
  type PdfSourceUrlRequest = protocols.sources.PdfSourceUrlRequest
  val PdfSourceUrlRequest: protocols.sources.PdfSourceUrlRequest.type = protocols.sources.PdfSourceUrlRequest
  type PdfSourceResponse = protocols.sources.PdfSourceResponse
  val PdfSourceResponse: protocols.sources.PdfSourceResponse.type = protocols.sources.PdfSourceResponse
  type ImageSourceConfigPayload = protocols.sources.ImageSourceConfigPayload
  val ImageSourceConfigPayload: protocols.sources.ImageSourceConfigPayload.type = protocols.sources.ImageSourceConfigPayload
  type ImageSourceUrlConfigPayload = protocols.sources.ImageSourceUrlConfigPayload
  val ImageSourceUrlConfigPayload: protocols.sources.ImageSourceUrlConfigPayload.type = protocols.sources.ImageSourceUrlConfigPayload
  type ImageSourceUrlRequest = protocols.sources.ImageSourceUrlRequest
  val ImageSourceUrlRequest: protocols.sources.ImageSourceUrlRequest.type = protocols.sources.ImageSourceUrlRequest
  type ImageSourceResponse = protocols.sources.ImageSourceResponse
  val ImageSourceResponse: protocols.sources.ImageSourceResponse.type = protocols.sources.ImageSourceResponse

  type CreatePipelineRequest = protocols.pipelines.CreatePipelineRequest
  val CreatePipelineRequest: protocols.pipelines.CreatePipelineRequest.type = protocols.pipelines.CreatePipelineRequest
  type UpdatePipelineRequest = protocols.pipelines.UpdatePipelineRequest
  val UpdatePipelineRequest: protocols.pipelines.UpdatePipelineRequest.type = protocols.pipelines.UpdatePipelineRequest
  type PipelineSummaryResponse = protocols.pipelines.PipelineSummaryResponse
  val PipelineSummaryResponse: protocols.pipelines.PipelineSummaryResponse.type = protocols.pipelines.PipelineSummaryResponse
  type CreatePipelineStepRequest = protocols.pipelines.CreatePipelineStepRequest
  val CreatePipelineStepRequest: protocols.pipelines.CreatePipelineStepRequest.type = protocols.pipelines.CreatePipelineStepRequest
  type UpdatePipelineStepRequest = protocols.pipelines.UpdatePipelineStepRequest
  val UpdatePipelineStepRequest: protocols.pipelines.UpdatePipelineStepRequest.type = protocols.pipelines.UpdatePipelineStepRequest
  type ReorderPipelineStepsRequest = protocols.pipelines.ReorderPipelineStepsRequest
  val ReorderPipelineStepsRequest: protocols.pipelines.ReorderPipelineStepsRequest.type = protocols.pipelines.ReorderPipelineStepsRequest
  type PipelineStepResponse = protocols.pipelines.PipelineStepResponse
  val PipelineStepResponse: protocols.pipelines.PipelineStepResponse.type = protocols.pipelines.PipelineStepResponse
  type AnalyzeStepResponse = protocols.pipelines.AnalyzeStepResponse
  // AnalyzeStepResponse is a sealed trait (no companion object); per-subtype
  // case classes (RenameAnalyzeStepResponse, etc.) are accessed directly from
  // protocols where needed.
  type PipelineAnalyzeResponse = protocols.pipelines.PipelineAnalyzeResponse
  val PipelineAnalyzeResponse: protocols.pipelines.PipelineAnalyzeResponse.type = protocols.pipelines.PipelineAnalyzeResponse
  type RunSubmitResponse = protocols.pipelines.RunSubmitResponse
  val RunSubmitResponse: protocols.pipelines.RunSubmitResponse.type = protocols.pipelines.RunSubmitResponse
  type RunStatusResponse = protocols.pipelines.RunStatusResponse
  val RunStatusResponse: protocols.pipelines.RunStatusResponse.type = protocols.pipelines.RunStatusResponse
  type PipelineRunRecord = protocols.pipelines.PipelineRunRecord
  val PipelineRunRecord: protocols.pipelines.PipelineRunRecord.type = protocols.pipelines.PipelineRunRecord
  type RunResultResponse = protocols.pipelines.RunResultResponse
  val RunResultResponse: protocols.pipelines.RunResultResponse.type = protocols.pipelines.RunResultResponse
  type AssertionFailureDetail = protocols.pipelines.AssertionFailureDetail
  val AssertionFailureDetail: protocols.pipelines.AssertionFailureDetail.type = protocols.pipelines.AssertionFailureDetail
  type AssertionSummary = protocols.pipelines.AssertionSummary
  val AssertionSummary: protocols.pipelines.AssertionSummary.type = protocols.pipelines.AssertionSummary
  type AssertionStatusResponse = protocols.pipelines.AssertionStatusResponse
  val AssertionStatusResponse: protocols.pipelines.AssertionStatusResponse.type = protocols.pipelines.AssertionStatusResponse

  type ImageUploadResponse = protocols.sources.ImageUploadResponse
  val ImageUploadResponse: protocols.sources.ImageUploadResponse.type = protocols.sources.ImageUploadResponse

  type GrantPermissionRequest = protocols.auth.GrantPermissionRequest
  val GrantPermissionRequest: protocols.auth.GrantPermissionRequest.type = protocols.auth.GrantPermissionRequest
  type PermissionResponse = protocols.auth.PermissionResponse
  val PermissionResponse: protocols.auth.PermissionResponse.type = protocols.auth.PermissionResponse
  type PermissionsResponse = protocols.auth.PermissionsResponse
  val PermissionsResponse: protocols.auth.PermissionsResponse.type = protocols.auth.PermissionsResponse

  type AlertRuleResponse = protocols.alerts.AlertRuleResponse
  val AlertRuleResponse: protocols.alerts.AlertRuleResponse.type = protocols.alerts.AlertRuleResponse
  type AlertRulesResponse = protocols.alerts.AlertRulesResponse
  val AlertRulesResponse: protocols.alerts.AlertRulesResponse.type = protocols.alerts.AlertRulesResponse
  type CreateAlertRuleRequest = protocols.alerts.CreateAlertRuleRequest
  val CreateAlertRuleRequest: protocols.alerts.CreateAlertRuleRequest.type = protocols.alerts.CreateAlertRuleRequest
  type UpdateAlertRuleRequest = protocols.alerts.UpdateAlertRuleRequest
  val UpdateAlertRuleRequest: protocols.alerts.UpdateAlertRuleRequest.type = protocols.alerts.UpdateAlertRuleRequest

  type AlertEventResponse = protocols.alerts.AlertEventResponse
  val AlertEventResponse: protocols.alerts.AlertEventResponse.type = protocols.alerts.AlertEventResponse
  type AlertEventsResponse = protocols.alerts.AlertEventsResponse
  val AlertEventsResponse: protocols.alerts.AlertEventsResponse.type = protocols.alerts.AlertEventsResponse
  type SnoozeAlertEventRequest = protocols.alerts.SnoozeAlertEventRequest
  val SnoozeAlertEventRequest: protocols.alerts.SnoozeAlertEventRequest.type = protocols.alerts.SnoozeAlertEventRequest

  // HEL-904 task 4.1: Metric aliases (HEL-446/HEL-493) removed outright —
  // `MetricProtocol` (their home) is deleted; metrics no longer exist.

  type PipelineScheduleResponse = protocols.pipelines.PipelineScheduleResponse
  val PipelineScheduleResponse: protocols.pipelines.PipelineScheduleResponse.type = protocols.pipelines.PipelineScheduleResponse
  type PutPipelineScheduleRequest = protocols.pipelines.PutPipelineScheduleRequest
  val PutPipelineScheduleRequest: protocols.pipelines.PutPipelineScheduleRequest.type = protocols.pipelines.PutPipelineScheduleRequest

  type ConnectorFieldDescriptorResponse = protocols.sources.ConnectorFieldDescriptorResponse
  val ConnectorFieldDescriptorResponse: protocols.sources.ConnectorFieldDescriptorResponse.type = protocols.sources.ConnectorFieldDescriptorResponse
  type ConnectorMetadataResponse = protocols.sources.ConnectorMetadataResponse
  val ConnectorMetadataResponse: protocols.sources.ConnectorMetadataResponse.type = protocols.sources.ConnectorMetadataResponse
  type ConnectorMeta = protocols.sources.ConnectorMeta
  val ConnectorMeta: protocols.sources.ConnectorMeta.type = protocols.sources.ConnectorMeta
  type ConnectorsResponse = protocols.sources.ConnectorsResponse
  val ConnectorsResponse: protocols.sources.ConnectorsResponse.type = protocols.sources.ConnectorsResponse
  type CreateConnectorRequest = protocols.sources.CreateConnectorRequest
  val CreateConnectorRequest: protocols.sources.CreateConnectorRequest.type = protocols.sources.CreateConnectorRequest
  type UpdateConnectorRequest = protocols.sources.UpdateConnectorRequest
  val UpdateConnectorRequest: protocols.sources.UpdateConnectorRequest.type = protocols.sources.UpdateConnectorRequest
  type RotateConnectorCredentialRequest = protocols.sources.RotateConnectorCredentialRequest
  val RotateConnectorCredentialRequest: protocols.sources.RotateConnectorCredentialRequest.type =
    protocols.sources.RotateConnectorCredentialRequest

  type OutputContractResponse = protocols.pipelines.OutputContractResponse
  val OutputContractResponse: protocols.pipelines.OutputContractResponse.type = protocols.pipelines.OutputContractResponse
  type PipelineShapeCatalogEntryResponse = protocols.pipelines.PipelineShapeCatalogEntryResponse
  val PipelineShapeCatalogEntryResponse: protocols.pipelines.PipelineShapeCatalogEntryResponse.type = protocols.pipelines.PipelineShapeCatalogEntryResponse

  type ExpandPipelineShapeRequest = protocols.pipelines.ExpandPipelineShapeRequest
  val ExpandPipelineShapeRequest: protocols.pipelines.ExpandPipelineShapeRequest.type = protocols.pipelines.ExpandPipelineShapeRequest
  type ShapeStepExpansionResponse = protocols.pipelines.ShapeStepExpansionResponse
  val ShapeStepExpansionResponse: protocols.pipelines.ShapeStepExpansionResponse.type = protocols.pipelines.ShapeStepExpansionResponse
  type ExpandPipelineShapeResponse = protocols.pipelines.ExpandPipelineShapeResponse
  val ExpandPipelineShapeResponse: protocols.pipelines.ExpandPipelineShapeResponse.type = protocols.pipelines.ExpandPipelineShapeResponse

  type TeardownRequest = protocols.workspace.TeardownRequest
  val TeardownRequest: protocols.workspace.TeardownRequest.type = protocols.workspace.TeardownRequest
  type TeardownConflictResponse = protocols.workspace.TeardownConflictResponse
  val TeardownConflictResponse: protocols.workspace.TeardownConflictResponse.type = protocols.workspace.TeardownConflictResponse
  type TeardownResponse = protocols.workspace.TeardownResponse
  val TeardownResponse: protocols.workspace.TeardownResponse.type = protocols.workspace.TeardownResponse

  type HookRunRequest = protocols.hooks.HookRunRequest
  val HookRunRequest: protocols.hooks.HookRunRequest.type = protocols.hooks.HookRunRequest
  type HookTriggerResponse = protocols.hooks.HookTriggerResponse
  val HookTriggerResponse: protocols.hooks.HookTriggerResponse.type = protocols.hooks.HookTriggerResponse

  type WorkspaceContextCounts = protocols.workspace.WorkspaceContextCounts
  val WorkspaceContextCounts: protocols.workspace.WorkspaceContextCounts.type = protocols.workspace.WorkspaceContextCounts
  type WorkspaceContextDataSource = protocols.workspace.WorkspaceContextDataSource
  val WorkspaceContextDataSource: protocols.workspace.WorkspaceContextDataSource.type = protocols.workspace.WorkspaceContextDataSource
  type WorkspaceContextColumn = protocols.workspace.WorkspaceContextColumn
  val WorkspaceContextColumn: protocols.workspace.WorkspaceContextColumn.type = protocols.workspace.WorkspaceContextColumn
  type WorkspaceContextComputedColumn = protocols.workspace.WorkspaceContextComputedColumn
  val WorkspaceContextComputedColumn: protocols.workspace.WorkspaceContextComputedColumn.type = protocols.workspace.WorkspaceContextComputedColumn
  type WorkspaceContextOutput = protocols.workspace.WorkspaceContextOutput
  val WorkspaceContextOutput: protocols.workspace.WorkspaceContextOutput.type = protocols.workspace.WorkspaceContextOutput
  type WorkspaceContextPipelineStep = protocols.workspace.WorkspaceContextPipelineStep
  val WorkspaceContextPipelineStep: protocols.workspace.WorkspaceContextPipelineStep.type = protocols.workspace.WorkspaceContextPipelineStep
  type WorkspaceContextPipeline = protocols.workspace.WorkspaceContextPipeline
  val WorkspaceContextPipeline: protocols.workspace.WorkspaceContextPipeline.type = protocols.workspace.WorkspaceContextPipeline
  type WorkspaceContextDashboard = protocols.workspace.WorkspaceContextDashboard
  val WorkspaceContextDashboard: protocols.workspace.WorkspaceContextDashboard.type = protocols.workspace.WorkspaceContextDashboard
  type WorkspaceContextResponse = protocols.workspace.WorkspaceContextResponse
  val WorkspaceContextResponse: protocols.workspace.WorkspaceContextResponse.type = protocols.workspace.WorkspaceContextResponse

  type AuthoringContextOptions = protocols.proposals.AuthoringContextOptions
  val AuthoringContextOptions: protocols.proposals.AuthoringContextOptions.type = protocols.proposals.AuthoringContextOptions
  type DashboardAuthoringRequest = protocols.proposals.DashboardAuthoringRequest
  val DashboardAuthoringRequest: protocols.proposals.DashboardAuthoringRequest.type = protocols.proposals.DashboardAuthoringRequest
  type DashboardAuthoringResponse = protocols.proposals.DashboardAuthoringResponse
  val DashboardAuthoringResponse: protocols.proposals.DashboardAuthoringResponse.type = protocols.proposals.DashboardAuthoringResponse
  type AuthoringStreamEvent = protocols.proposals.AuthoringStreamEvent
  val AuthoringStreamEvent: protocols.proposals.AuthoringStreamEvent.type = protocols.proposals.AuthoringStreamEvent
  // Authoring error kind + apply-outcome correlation (HEL-401)
  type AuthoringErrorResponse = protocols.proposals.AuthoringErrorResponse
  val AuthoringErrorResponse: protocols.proposals.AuthoringErrorResponse.type = protocols.proposals.AuthoringErrorResponse
  type AuthoringOutcomeRequest = protocols.proposals.AuthoringOutcomeRequest
  val AuthoringOutcomeRequest: protocols.proposals.AuthoringOutcomeRequest.type = protocols.proposals.AuthoringOutcomeRequest

  type RefinementTarget = protocols.patchsets.RefinementTarget
  val RefinementTarget: protocols.patchsets.RefinementTarget.type = protocols.patchsets.RefinementTarget
  type RefinementRequest = protocols.patchsets.RefinementRequest
  val RefinementRequest: protocols.patchsets.RefinementRequest.type = protocols.patchsets.RefinementRequest
  type RefinementResponse = protocols.patchsets.RefinementResponse
  val RefinementResponse: protocols.patchsets.RefinementResponse.type = protocols.patchsets.RefinementResponse
}
