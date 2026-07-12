import {
  BookOpen,
  CheckCircle2,
  CircleAlert,
  HelpCircle,
  Image as ImageIcon,
  MapPin,
  Paperclip,
  Save,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectNotebook } from "./types";

export interface ReferenceImage {
  id: string;
  name: string;
  dataUrl: string;
}

export function SceneMismatchBanner({
  notebook,
  onKeep,
  onNewChat,
}: {
  notebook?: ProjectNotebook;
  onKeep: () => void;
  onNewChat: () => void;
}) {
  if (!notebook?.sceneMismatch) return null;
  const previous = notebook.lastSceneName || "the previous Blender file";
  const current = notebook.currentSceneName || "this Blender file";
  return (
    <section className="scene-mismatch" role="status">
      <CircleAlert size={18} />
      <div>
        <strong>This chat started with {previous}</strong>
        <p>Blender now shows {current}. Keep this chat if it is the same project, or start clean.</p>
      </div>
      <div className="scene-mismatch-actions">
        <button type="button" onClick={onKeep}>Keep chat</button>
        <button type="button" className="primary-compact" onClick={onNewChat}>New chat</button>
      </div>
    </section>
  );
}

export function CurrentCheckpoint({
  disabled,
  onFollowUp,
}: {
  disabled: boolean;
  onFollowUp: (prompt: string) => void;
}) {
  return (
      <div className="checkpoint-actions" aria-label="Follow-up shortcuts">
        <button
          type="button"
          disabled={disabled}
          title="Check my work"
          aria-label="Check my work"
          onClick={() => onFollowUp("Check my work against the last step. Capture fresh Blender evidence first, tell me what is correct, and give me only the next correction if one is needed.")}
        >
          <CheckCircle2 size={14} /> Check
        </button>
        <button
          type="button"
          disabled={disabled}
          title="I am stuck"
          aria-label="I am stuck"
          onClick={() => onFollowUp("I am stuck on the last step. Use fresh Blender evidence, identify the most likely blocker, and give me one simple recovery action.")}
        >
          <HelpCircle size={14} /> Stuck
        </button>
        <button
          type="button"
          disabled={disabled}
          title="Show me where"
          aria-label="Show me where"
          onClick={() => onFollowUp("Show me exactly where the control for the last step is in Blender. Use fresh visual evidence and describe the clicks in plain location words without changing my scene.")}
        >
          <MapPin size={14} /> Where
        </button>
      </div>
  );
}

export function ProjectNotebookEditor({
  value,
  saved,
  saving,
  onChange,
  onSave,
}: {
  value: string;
  saved: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <section className="notebook-editor">
      <div className="notebook-intro">
        <BookOpen size={18} />
        <div>
          <h3>Project Notebook</h3>
          <p>Keep the goal, style, measurements, and decisions for this chat. It is not locked to a Blender file.</p>
        </div>
      </div>
      <label>
        <span className="sr-only">Project notebook</span>
        <textarea
          value={value}
          maxLength={8000}
          placeholder="Example: I am making a friendly low-poly robot. Keep the body under 2 meters, use rounded shapes, and explain one checkpoint at a time."
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="notebook-footer">
        <small>{value.length.toLocaleString()} / 8,000</small>
        <button type="button" className="secondary-button" onClick={onSave} disabled={saving || saved}>
          <Save size={15} /> {saving ? "Saving" : saved ? "Saved" : "Save notebook"}
        </button>
      </div>
    </section>
  );
}

export function ReferenceAttachmentTray({
  images,
  error,
  supportsVision,
  onChoose,
  onRemove,
  actions,
}: {
  images: ReferenceImage[];
  error: string;
  supportsVision: boolean;
  onChoose: (files: FileList) => void;
  onRemove: (id: string) => void;
  actions?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="reference-tray">
      {images.length > 0 && (
        <div className="reference-previews" aria-label="Attached reference images">
          {images.map((image) => (
            <figure key={image.id}>
              <img src={image.dataUrl} alt={`Reference: ${image.name}`} />
              <figcaption>{image.name}</figcaption>
              <button type="button" onClick={() => onRemove(image.id)} aria-label={`Remove ${image.name}`}>
                <X size={13} />
              </button>
            </figure>
          ))}
        </div>
      )}
      <div className="reference-control-row">
        <button
          type="button"
          className="attach-reference"
          disabled={!supportsVision || images.length >= 2}
          onClick={() => inputRef.current?.click()}
          title={supportsVision ? "Attach up to two desktop photos. Blendy prepares them for LM Studio." : "Load a vision-capable model to attach images"}
        >
          <Paperclip size={16} />
          <span>{images.length ? `${images.length} reference${images.length > 1 ? "s" : ""}` : "Add reference"}</span>
        </button>
        {actions}
        {images.length > 0 && <small>Images go to the selected LM Studio model for this turn and are not saved in chat.</small>}
        {!supportsVision && <small>The loaded model cannot read images.</small>}
      </div>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/*,.png,.jpg,.jpeg,.jfif,.webp,.bmp,.gif,.avif,.heic,.heif,.tif,.tiff"
        multiple
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files?.length) onChoose(event.target.files);
          event.target.value = "";
        }}
      />
      {error && <p className="reference-error" role="alert"><CircleAlert size={14} /> {error}</p>}
    </div>
  );
}

export function EmptyStudioState({ onStarter }: { onStarter: (prompt: string) => void }) {
  return (
    <section className="empty-studio">
      <span className="empty-studio-icon"><ImageIcon size={24} /></span>
      <h1>What are you making?</h1>
      <p>Describe the result in your own words. Blendy will turn it into one manageable Blender checkpoint at a time.</p>
      <div className="starter-prompts">
        <button type="button" onClick={() => onStarter("I am starting a new Blender project. Help me turn this idea into a simple plan, then give me only the first checkpoint: ")}>Plan a new project</button>
        <button type="button" onClick={() => onStarter("Look at my current Blender scene and tell me the single most useful next step.")}>Read my current scene</button>
        <button type="button" onClick={() => onStarter("I am a Blender beginner and something is not working. Help me diagnose it one check at a time: ")}>Fix something</button>
      </div>
    </section>
  );
}
