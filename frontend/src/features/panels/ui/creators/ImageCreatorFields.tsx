// Image subtype creator fields — image URL input.
//
// Rendered by PanelCreationModal's name-entry step when selectedType is
// "image". The shell narrows `typeConfig` into an `ImageTypeConfig`
// before passing it in so the input stays controlled from first render.

import { TextField } from "../../../../shared/ui/index";
import type { ImageTypeConfig } from "../../types/panel";
import type { CreatorFieldsProps } from "./creatorTypes";

export function ImageCreatorFields({ config, onChange }: CreatorFieldsProps<ImageTypeConfig>) {
  return (
    <div className="panel-creation-modal__field">
      <label className="panel-creation-modal__label" htmlFor="panel-create-image-url">
        Image URL
      </label>
      {/* F-112 — `type="text"`, not `type="url"`: the latter's native
          constraint validation (a bare "Please enter a URL." bubble, no
          context) fires on submit for anything without an explicit scheme,
          even though the backend/renderer accept a root-relative upload
          path just as happily. Matches `ImageEditor`'s own Image URL field
          (`panel-detail-modal__data-section`), which has never used
          `type="url"` either. */}
      <TextField
        id="panel-create-image-url"
        type="text"
        value={config.imageUrl ?? ""}
        onChange={(e) => onChange({ ...config, imageUrl: e.target.value || undefined })}
        placeholder="https://example.com/image.jpg"
        aria-label="Image URL"
      />
    </div>
  );
}
