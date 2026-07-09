import {
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Compass,
  Cpu,
  HelpCircle,
  Image as ImageIcon,
  MapPin,
  Paperclip,
  Save,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ContextSnapshot, ModelStatus, ProjectNotebook } from "./types";

export interface ReferenceImage {
  id: string;
  name: string;
  dataUrl: string;
}

interface ReadinessPanelProps {
  context: ContextSnapshot;
  modelStatus?: ModelStatus;
  isGenerating: boolean;
  canStop: boolean;
  generationStage?: { stage: string; label: string };
  onStop: () => void;
  onRefresh: () => void;
}

function statusText(value: boolean | undefined, ready: string, missing: string, checking: string) {
  if (value === true) return ready;
  if (value === false) return missing;
  return checking;
}

export function ReadinessPanel({
  context,
  modelStatus,
  isGenerating,
  canStop,
  generationStage,
  onStop,
  onRefresh,
}: ReadinessPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const blenderConnected = context.bridgeOk === true;
  const serverReachable = modelStatus?.reachable === true;
  const modelReady = serverReachable
    && Boolean(modelStatus?.modelId)
    && modelStatus?.loaded !== false
    && modelStatus?.chatCapable !== false;
  const modelName = modelStatus?.displayName || modelStatus?.modelId || "Local model";
  const headline = !modelStatus
    ? "Checking your local setup"
    : blenderConnected && modelReady
    ? `${modelName} is ready with Blender`
    : !serverReachable
      ? "Start LM Studio when you are ready to chat"
      : !modelReady
        ? "Load a chat model in LM Studio"
      : "General guidance mode";

  return (
    <section className={`readiness-panel ${blenderConnected && modelReady ? "ready" : "needs-attention"}`} aria-label="Connection readiness">
      <div className="readiness-summary-row">
        <button
          type="button"
          className="readiness-summary"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="readiness-mark" aria-hidden="true">
            {blenderConnected && modelReady ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
          </span>
          <span className="readiness-copy" aria-live={isGenerating ? "polite" : "off"}>
            <strong>{isGenerating ? generationStage?.label || "Preparing your answer" : headline}</strong>
            <small>
              {isGenerating
                ? canStop
                  ? "The selected model is working. You can stop without losing your question."
                  : "Blendy is preparing scene evidence. Stop becomes available when model generation begins."
                : !modelStatus
                  ? "This normally takes only a moment."
                : !blenderConnected
                  ? "Ask general questions now, or open Blender for scene-aware help."
                  : !serverReachable
                    ? "Blender is connected. LM Studio is the only missing piece."
                    : !modelReady
                      ? "LM Studio is reachable, but no chat model is loaded."
                      : "Scene awareness and your loaded model are available."}
            </small>
          </span>
          {!isGenerating && (expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />)}
        </button>
        {isGenerating && canStop ? (
          <button
            type="button"
            className="stop-generation"
            onClick={onStop}
          >
            <Square size={13} fill="currentColor" />
            Stop
          </button>
        ) : null}
      </div>

      {isGenerating && (
        <div className="generation-progress" aria-live="polite">
          <span className="generation-progress-fill" />
        </div>
      )}

      {expanded && !isGenerating && (
        <div className="readiness-details">
          <ReadinessLine
            icon={<Wrench size={16} />}
            label="Blender"
            value={statusText(context.bridgeOk, "Connected", "Not connected", "Checking")}
            help={blenderConnected ? context.blenderVersion || "Scene data is available" : "Open Blender. Blendy can still give general guidance without it."}
            ok={blenderConnected}
          />
          <ReadinessLine
            icon={<Cpu size={16} />}
            label="LM Studio"
            value={statusText(modelStatus?.reachable, "Reachable", "Not running", "Checking")}
            help={serverReachable
              ? modelReady
                ? `${modelName} is loaded and chat-capable.`
                : "LM Studio is open. Load a chat model, then check again."
              : modelStatus?.error || "Open LM Studio, load your Gemma model, then refresh."}
            ok={modelReady}
          />
          <div className="capability-row" aria-label="Selected model capabilities">
            <span className={modelStatus?.vision ? "available" : "unavailable"}><Camera size={14} /> Vision</span>
            <span className={modelStatus?.toolUse ? "available" : "unavailable"}><Wrench size={14} /> Tools</span>
            <span className={modelStatus?.chatCapable !== false ? "available" : "unavailable"}><BookOpen size={14} /> Chat</span>
          </div>
          <button type="button" className="secondary-button readiness-refresh" onClick={onRefresh}>Check again</button>
        </div>
      )}
    </section>
  );
}

function ReadinessLine({
  icon,
  label,
  value,
  help,
  ok,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  help: string;
  ok: boolean;
}) {
  return (
    <div className="readiness-line">
      <span className="readiness-line-icon">{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
      <p>{help}</p>
      <span className={`semantic-status ${ok ? "ok" : "waiting"}`} aria-label={ok ? "Ready" : "Needs attention"} />
    </div>
  );
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
  content,
  disabled,
  onFollowUp,
}: {
  content: string;
  disabled: boolean;
  onFollowUp: (prompt: string) => void;
}) {
  const summary = checkpointSummary(content);
  if (!summary) return null;
  return (
    <section className="checkpoint-card" aria-label="Current checkpoint">
      <div className="checkpoint-heading">
        <span><Compass size={16} /> Current checkpoint</span>
        <p>{summary}</p>
      </div>
      <div className="checkpoint-actions">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFollowUp("Check my work against the last step. Capture fresh Blender evidence first, tell me what is correct, and give me only the next correction if one is needed.")}
        >
          <CheckCircle2 size={15} /> Check my work
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFollowUp("I am stuck on the last step. Use fresh Blender evidence, identify the most likely blocker, and give me one simple recovery action.")}
        >
          <HelpCircle size={15} /> I am stuck
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFollowUp("Show me exactly where the control for the last step is in Blender. Use fresh visual evidence and describe the clicks in plain location words without changing my scene.")}
        >
          <MapPin size={15} /> Show me where
        </button>
      </div>
    </section>
  );
}

function checkpointSummary(content: string) {
  const paragraphs = content
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
    .filter(Boolean);
  const candidate = paragraphs.find((line) => /\b(select|open|click|press|set|change|add|move|scale|rotate|check|try|use|create|make)\b/i.test(line)) || paragraphs[0];
  if (!candidate) return "";
  return candidate.length > 190 ? `${candidate.slice(0, 187).trim()}...` : candidate;
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
  disabled,
  supportsVision,
  onChoose,
  onRemove,
}: {
  images: ReferenceImage[];
  error: string;
  disabled: boolean;
  supportsVision: boolean;
  onChoose: (files: FileList) => void;
  onRemove: (id: string) => void;
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
          disabled={disabled || !supportsVision || images.length >= 2}
          onClick={() => inputRef.current?.click()}
          title={supportsVision ? "Attach up to two PNG, JPEG, or WebP reference images" : "Load a vision-capable model to attach images"}
        >
          <Paperclip size={16} />
          <span>{images.length ? `${images.length} reference${images.length > 1 ? "s" : ""}` : "Add reference"}</span>
        </button>
        {images.length > 0 && <small>Images go to the selected LM Studio model for this turn and are not saved in chat.</small>}
        {!supportsVision && <small>The loaded model cannot read images.</small>}
      </div>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
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
