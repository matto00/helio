// HEL-1587: the shape `fetchPublicDashboardPanels` resolves to (`{panels, layout}`), for tests that mock it.
import type { DashboardLayout } from "../features/dashboards/types/dashboard";
import type { Panel } from "../features/panels/types/panel";

export const emptyPublicLayout: DashboardLayout = { lg: [], md: [], sm: [], xs: [] };

export function publicPanelsResult(
  panels: Panel[],
  layout: DashboardLayout = emptyPublicLayout,
): { panels: Panel[]; layout: DashboardLayout } {
  return { panels, layout };
}
