// SpineViewOnly -- HEL-1661 (design.md D5): the "View only" fact a viewer grantee sees on the pipeline page, the pipeline
// counterpart of the dashboard's (HEL-1782 D1, `app/dashboardMeta/DashboardMetaFacts.tsx`): a plain meta fact, no pill and no
// accent, in the meta text's own type with an Eye icon before it; visible and not aria-hidden. The copy is the dashboard's.

import { Eye } from "lucide-react";

import { VIEW_ONLY_TEXT } from "../../../../app/dashboardMeta/DashboardMetaFacts";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import "./PipelineSpineHeader.css";

export function SpineViewOnly() {
  return (
    <span className="spine-header__view-only">
      <Eye size={ICON_SIZE.sm} aria-hidden="true" />
      {VIEW_ONLY_TEXT}
    </span>
  );
}
