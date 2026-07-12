import {
  type ChangeEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Select, TextField } from "../../../../shared/ui/index";
import { updatePanelImage } from "../../state/panelsSlice";
import { uploadPanelImage } from "../../services/panelService";
import { useAppDispatch } from "../../../../hooks/reduxHooks";
import type { ImageFit, ImagePanel } from "../../types/panel";
import { InlineError } from "../../../../shared/chrome/InlineError";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";

// HEL-246: extensions accepted by POST /api/uploads/image
// (ImageUploadService.allowedExtensions) — kept in sync manually since the
// backend is the source of truth for what it actually accepts; this is only
// an `accept` hint for the OS file picker, not a validation gate.
const ACCEPTED_UPLOAD_EXTENSIONS = ".png,.jpg,.jpeg,.gif,.webp";

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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dirty = imageUrl !== initialImageUrl || imageFit !== initialImageFit;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // HEL-246: uploads a file via the standalone image-upload endpoint and
  // sets `imageUrl` to the returned URL, exactly as if it had been typed
  // into the URL field. On failure the field is left unchanged and an
  // inline error is shown — the upload never clobbers a prior valid URL.
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input's value so selecting the same file again still fires
    // a change event.
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const result = await uploadPanelImage(file);
      setImageUrl(result.url);
    } catch {
      setUploadError("Upload failed. Please choose a different image.");
    } finally {
      setIsUploading(false);
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        setImageUrl(initialImageUrl);
        setImageFit(initialImageFit);
        setSaveError(null);
        setUploadError(null);
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
        <div className="panel-detail-modal__upload-row">
          <TextField
            id="image-url"
            type="text"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            aria-label="Image URL"
            placeholder="https://example.com/image.png"
          />
          <input
            ref={fileInputRef}
            type="file"
            className="panel-detail-modal__upload-input"
            accept={ACCEPTED_UPLOAD_EXTENSIONS}
            onChange={handleFileChange}
            aria-label="Upload image file"
          />
          <button
            type="button"
            className="panel-detail-modal__upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        <InlineError error={uploadError} />
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
