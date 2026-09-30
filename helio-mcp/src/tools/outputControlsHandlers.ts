/**
 * Output-panel control tools' call-routing logic (HEL-1193), split from `outputControls.ts` on
 * the same zod-free-handlers convention as `outputsHandlers.ts`.
 *
 * `PATCH /api/panels/:id` replaces `config.controls` WHOLESALE, so every mutation here is a
 * read-modify-write: read the panel's current controls from the dashboard export, change the
 * list locally, PATCH the whole list back. Two concurrent writers are last-write-wins (the same
 * as `update_panel`). Eligibility is never decided here: the only client-side rule is the column
 * PICK when `column` is omitted, and that reads the backend's own `controlKinds`. Whether a
 * supplied column/kind is allowed is the backend's call (400 `control not eligible: ...`,
 * surfaced unchanged).
 */

import { randomUUID } from "node:crypto";
import type { HelioApi } from "../helioApi.js";
import type { OutputControl, OutputControlKind, PanelResponse } from "../types.js";

/** Attributes the backend's strict control decoder accepts; anything else echoed back (a
 *  read-time `orphaned` flag, say) would be rejected as an unrecognized attribute. */
const CONTROL_KEYS = ["id", "kind", "column", "label", "defaultValue"] as const;

export class ControlToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlToolError";
  }
}

interface PanelTarget {
  dashboardId: string;
  panelId: string;
}

async function readOutputPanelControls(
  api: HelioApi,
  { dashboardId, panelId }: PanelTarget,
): Promise<{ outputId: string; controls: OutputControl[] }> {
  const snapshot = await api.getDashboardSnapshot(dashboardId);
  const panel = snapshot.panels.find((p) => p.id === panelId);
  if (!panel) {
    throw new ControlToolError(`Panel ${panelId} was not found on dashboard ${dashboardId}.`);
  }
  if (panel.type !== "output") {
    throw new ControlToolError(
      `Panel ${panelId} is a '${panel.type}' panel; controls exist only on output panels.`,
    );
  }
  const config = (panel.config ?? {}) as { outputId?: string; controls?: unknown[] };
  if (!config.outputId) {
    throw new ControlToolError(`Output panel ${panelId} has no outputId binding.`);
  }
  const controls = (config.controls ?? []).map((raw) => {
    const source = raw as Record<string, unknown>;
    return Object.fromEntries(
      CONTROL_KEYS.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
    ) as unknown as OutputControl;
  });
  return { outputId: config.outputId, controls };
}

function writeControls(
  api: HelioApi,
  panelId: string,
  controls: OutputControl[],
): Promise<PanelResponse> {
  return api.updatePanel(panelId, { config: { controls } });
}

export function getOutputFilterCapabilitiesHandler(api: HelioApi, outputId: string) {
  return api.getOutputFilterCapabilities(outputId);
}

export async function addOutputControlHandler(
  api: HelioApi,
  input: PanelTarget & {
    kind: OutputControlKind;
    column?: string;
    label?: string;
    defaultValue?: unknown;
  },
  mintId: () => string = randomUUID,
): Promise<PanelResponse> {
  const { outputId, controls } = await readOutputPanelControls(api, input);

  let column = input.column;
  if (column === undefined) {
    const { columns } = await api.getOutputFilterCapabilities(outputId);
    column = columns.find((c) => c.controlKinds.includes(input.kind))?.column;
    if (column === undefined) {
      const offered = columns.map((c) => `${c.column}: [${c.controlKinds.join(", ")}]`).join("; ");
      throw new ControlToolError(
        `No column of output ${outputId} is eligible for a '${input.kind}' control. ` +
          `Eligible control kinds per column: ${offered || "(no filterable columns)"}.`,
      );
    }
  }

  const control: OutputControl = {
    id: mintId(),
    kind: input.kind,
    column,
    label: input.label ?? column,
    ...(input.defaultValue !== undefined ? { defaultValue: input.defaultValue } : {}),
  };
  return writeControls(api, input.panelId, [...controls, control]);
}

export async function updateOutputControlHandler(
  api: HelioApi,
  input: PanelTarget & {
    controlId: string;
    kind?: OutputControlKind;
    column?: string;
    label?: string;
    /** `null` clears the control's default; omitted leaves it unchanged. */
    defaultValue?: unknown;
  },
): Promise<PanelResponse> {
  const { controls } = await readOutputPanelControls(api, input);
  const existing = controls.find((c) => c.id === input.controlId);
  if (!existing) {
    throw new ControlToolError(
      `Control ${input.controlId} was not found on panel ${input.panelId} (present: ${controls.map((c) => c.id).join(", ") || "none"}).`,
    );
  }
  const { defaultValue: currentDefault, ...rest } = existing;
  const nextDefault = input.defaultValue === undefined ? currentDefault : input.defaultValue;
  const updated: OutputControl = {
    ...rest,
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.column !== undefined ? { column: input.column } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(nextDefault !== undefined && nextDefault !== null ? { defaultValue: nextDefault } : {}),
  };
  return writeControls(
    api,
    input.panelId,
    controls.map((c) => (c.id === input.controlId ? updated : c)),
  );
}

export async function removeOutputControlHandler(
  api: HelioApi,
  input: PanelTarget & { controlId: string },
): Promise<PanelResponse> {
  const { controls } = await readOutputPanelControls(api, input);
  if (!controls.some((c) => c.id === input.controlId)) {
    throw new ControlToolError(
      `Control ${input.controlId} was not found on panel ${input.panelId} (present: ${controls.map((c) => c.id).join(", ") || "none"}).`,
    );
  }
  return writeControls(
    api,
    input.panelId,
    controls.filter((c) => c.id !== input.controlId),
  );
}
