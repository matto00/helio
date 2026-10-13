#!/usr/bin/env bash
# HEL-1501 commit 2: generate the moved regions of pipelinesSlice.ts from SPLIT_BASE (f63ab8365),
# so every moved byte is sourced mechanically, not retyped. Header (imports) and the
# `export` keyword on the two state declarations are the only authored text.
set -euo pipefail
BASE=${SPLIT_BASE:-f63ab8365}
D=frontend/src/features/pipelines/state
src() { git show "$BASE:$D/pipelinesSlice.ts"; }
r() { src | sed -n "$1,$2p"; }

{
cat <<'H'
import { createAsyncThunk } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import type { RootState } from "../../../store/store";
import {
  getPipelines,
  createPipeline as createPipelineRequest,
  deletePipeline as deletePipelineRequest,
  runPipeline,
  fetchRunHistory,
  getPipelineById,
  getPipelineSteps,
  updatePipeline as updatePipelineRequest,
  analyzePipeline as analyzePipelineRequest,
} from "../services/pipelineService";
import { applyPipelineProposal as applyPipelineProposalRequest } from "../services/pipelineProposalService";
import {
  classifyRequestError,
  type RequestErrorKind,
} from "../../../services/classifyRequestError";
import type {
  PipelineAnalyzeResponse,
  PipelineRunRecord,
  PipelineStep,
  PipelineSummary,
} from "../types/pipelineStep";
import type { PipelineProposal, PipelineProposalApplyResponse } from "../types/pipelineProposal";

H
r 44 72      # PipelineSummaryWire + normalizePipelineSummary (+ trailing blank)
r 182 365    # thunks fetchPipelines .. applyPipelineProposal
} > $D/pipelinesThunks.ts

{
cat <<'H'
import { createAsyncThunk } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  getPipelineSchedule,
  putPipelineSchedule,
  deletePipelineSchedule as deletePipelineScheduleRequest,
} from "../services/pipelineService";
import type { PipelineSchedule, PutPipelineScheduleRequest } from "../types/pipelineSchedule";

H
r 34 43      # extractErrorMessage (+ trailing blank)
r 367 413    # schedule thunks
} > $D/pipelineScheduleThunks.ts

{
cat <<'H'
import type { RequestErrorKind } from "../../../services/classifyRequestError";
import type {
  PipelineAnalyzeResponse,
  PipelineRunRecord,
  PipelineStep,
  PipelineSummary,
  RunStatus,
} from "../types/pipelineStep";
import type { PipelineSchedule } from "../types/pipelineSchedule";

H
r 73 180 | sed -e 's/^interface PipelinesState {$/export interface PipelinesState {/' -e 's/^const initialState: PipelinesState = {$/export const initialState: PipelinesState = {/'
} > $D/pipelinesState.ts
