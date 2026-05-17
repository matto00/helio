import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { Select, TextField } from "../../../shared/ui/index";
import { updatePanelImage } from "../../../features/panels/panelsSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { ImageFit, ImagePanel } from "../../../types/models";
import { InlineError } from "../../../shared/chrome/InlineError";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";

interface ImageEditorProps {
  panel: ImagePanel;
  onDirtyChange: DirtyChangeCallback;
}

const DEFAULT_FIT: ImageFit = "contain";

function coerceFit(value: string): ImageFit {
  return value === "contain" || value === "cover" || value === "fill" ? value : DEFAULT_FIT;
}

export const ImageEditor = forwardRef<PanelEditorHandle, ImageEditorProps>(function ImageEditor(
  { panel, onDirtyChange },
  ref,
) {
  const dispatch = useAppDispatch();
  const initialImageUrl = panel.config.imageUrl;
  const initialImageFit: ImageFit = coerceFit(panel.config.imageFit);
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [imageFit, setImageFit] = useState<ImageFit>(initialImageFit);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = imageUrl !== initialImageUrl || imageFit !== initialImageFit;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        setImageUrl(initialImageUrl);
        setImageFit(initialImageFit);
        setSaveError(null);
      },
      save: async () => {
        if (!dirty) return { ok: true };
        try {
          await dispatch(updatePanelImage({ panelId: panel.id, imageUrl, imageFit })).unwrap();
          return { ok: true };
        } catch {
          const error = "Failed to save image settings.";
          setSaveError(error);
          return { ok: false, error };
        }
      },
    }),
    [dirty, dispatch, imageFit, imageUrl, initialImageFit, initialImageUrl, panel.id],
  );

  return (
    <>
      <h3 className="panel-detail-modal__edit-section-heading">Image</h3>
      <div className="panel-detail-modal__data-section">
        <label className="panel-detail-modal__data-label" htmlFor="image-url">
          Image URL
        </label>
        <TextField
          id="image-url"
          type="text"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          aria-label="Image URL"
          placeholder="https://example.com/image.png"
        />
      </div>
      <div className="panel-detail-modal__data-section">
        <label className="panel-detail-modal__data-label" htmlFor="image-fit">
          Image fit
        </label>
        <Select
          ariaLabel="Image fit"
          value={imageFit}
          onChange={(v) => setImageFit(coerceFit(v))}
          options={[
            { value: "contain", label: "Contain" },
            { value: "cover", label: "Cover" },
            { value: "fill", label: "Fill" },
          ]}
        />
      </div>
      <InlineError error={saveError} />
    </>
  );
});
