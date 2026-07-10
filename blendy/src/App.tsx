import {
  Check,
  ChevronLeft,
  Eye,
  Image,
  Info,
  Menu,
  Minus,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  RefreshCcw,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import logoUrl from "./assets/blendy-header-mark.png";
import { inferReferenceMimeType } from "./referenceImages";
import { contextSnapshot as mockContextSnapshot, seedMessages } from "./data";
import {
  CurrentCheckpoint,
  EmptyStudioState,
  ProjectNotebookEditor,
  ReferenceAttachmentTray,
  SceneMismatchBanner,
  type ReferenceImage,
} from "./StudioCoach";
import type {
  AppSettings,
  AssistantReceipt,
  BackendSettings,
  ChatEvent,
  ChatSession,
  ContextSnapshot,
  KnowledgeMode,
  Message,
  ModelStatus,
  PageName,
  ProjectNotebook,
  ThemeName,
  ToolUseMode,
} from "./types";

const SETTINGS_KEY = "blendy.prototype.settings";

const defaultSettings: AppSettings = {
  theme: "solar",
  textSize: 15,
};

const defaultBackendSettings: BackendSettings = {
  bridgeUrl: "auto",
  lmStudioBaseUrl: "http://localhost:1234/v1",
  model: "auto",
  responseMaxTokens: 2200,
  contextLimitTokens: 70000,
  toolUse: "AUTO",
  userInstructions: "",
  knowledgeMode: "ASK_BEFORE_WEB",
};

const CONTEXT_LIMIT_MIN_TOKENS = 10000;
const CONTEXT_LIMIT_MAX_TOKENS = 256000;
const CONTEXT_LIMIT_STEP_TOKENS = 1000;

const themeLabels: Record<ThemeName, string> = {
  solar: "Scholastic Solar (Light)",
  sprint: "Neon Sprint (Dark)",
};

function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return defaultSettings;
    }
    const saved = JSON.parse(raw) as {
      theme?: ThemeName;
      textSize?: number;
    };
    return {
      ...defaultSettings,
      theme: saved.theme || defaultSettings.theme,
      textSize: saved.textSize || defaultSettings.textSize,
    };
  } catch (_error) {
    return defaultSettings;
  }
}

function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value >= 1000) {
    const rounded = value >= 10000 ? Math.round(value / 1000) : Math.round(value / 100) / 10;
    return `${rounded}k`;
  }
  return String(Math.round(value));
}

function clampContextLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultBackendSettings.contextLimitTokens;
  }
  return Math.min(CONTEXT_LIMIT_MAX_TOKENS, Math.max(CONTEXT_LIMIT_MIN_TOKENS, Math.round(value)));
}

function contextButtonLabel(contextSnapshot: ContextSnapshot): string {
  const used = contextSnapshot.contextTokens || 0;
  const limit = contextSnapshot.contextLimitTokens || 70000;
  const conversation = contextSnapshot.conversationTokens || 0;
  const tools = (contextSnapshot.toolDefinitionTokens || 0) + (contextSnapshot.toolReserveTokens || 0);
  const screenshot = contextSnapshot.imageReserveTokens || 0;
  return `Context ${formatTokens(used)} / ${formatTokens(limit)}. Conversation ${formatTokens(conversation)}. Tools ${formatTokens(tools)}. Screenshot ${formatTokens(screenshot)}.`;
}

const MAX_REFERENCE_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_REFERENCE_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCE_EDGE = 2048;

function decodedDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

async function prepareReferenceImage(file: File, preferredMimeType: string): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (_error) {
    throw new Error(`${file.name} could not be decoded as a photo. Open it in Photos and save a JPG or PNG copy, then try again.`);
  }
  try {
    const scale = Math.min(1, MAX_REFERENCE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: preferredMimeType === "image/png" });
    if (!context) throw new Error(`${file.name} could not be prepared for LM Studio.`);
    if (preferredMimeType !== "image/png") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const outputType = preferredMimeType === "image/png" || preferredMimeType === "image/webp"
      ? preferredMimeType
      : "image/jpeg";
    let dataUrl = canvas.toDataURL(outputType, 0.9);
    if (decodedDataUrlBytes(dataUrl) > MAX_REFERENCE_OUTPUT_BYTES) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    }
    if (decodedDataUrlBytes(dataUrl) > MAX_REFERENCE_OUTPUT_BYTES) {
      throw new Error(`${file.name} is still too detailed after resizing. Export a smaller JPG and try again.`);
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}

function receiptContextLabel(receipt?: AssistantReceipt, toolTrace?: AssistantReceipt["toolTrace"]) {
  const trace = receipt?.toolTrace || toolTrace || [];
  const usedScene = receipt?.usedScene || trace.some((entry) => entry.sceneUsed || /scene|context/i.test(entry.call?.name || entry.name || ""));
  const usedScreenshot = receipt?.usedScreenshot || trace.some((entry) => entry.screenshotUsed || /screen|visual|image/i.test(entry.call?.name || entry.name || ""));
  const tools = trace.map((entry) => entry.call?.name || entry.name).filter(Boolean);
  const parts = [
    usedScene ? "live scene" : "available context",
    usedScreenshot ? "fresh screen" : "",
    tools.length ? `${tools.length} local check${tools.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `Used: ${parts.join(" + ")}`;
}

function normalizeEventReceipt(
  incoming?: AssistantReceipt | { line?: string; details?: AssistantReceipt },
  toolTrace?: AssistantReceipt["toolTrace"],
  finishReason?: string,
  eventSources?: Array<{ title?: string; url?: string }>,
) {
  const wrapped = incoming && "details" in incoming ? incoming : undefined;
  const details = wrapped?.details || (incoming as AssistantReceipt | undefined) || {};
  const fallbackSources = [
    ...(eventSources || []),
    ...((details.web?.sources || []).map((source) => ({ title: source.title, url: source.url }))),
  ].filter((source) => source.url);
  const receipt: AssistantReceipt = {
    ...details,
    toolTrace: details.toolTrace || toolTrace,
    finishReason: details.finishReason || finishReason,
    sources: details.sources?.length ? details.sources : fallbackSources,
  };
  return {
    receipt,
    line: wrapped?.line || receiptContextLabel(receipt, toolTrace),
  };
}

function operationNotice(title: string, error: unknown, recovery: string): Message {
  const detail = error instanceof Error ? error.message : String(error || "Unknown error");
  return {
    id: crypto.randomUUID(),
    role: "event",
    content: `${title}\n${detail}\n${recovery}`,
    status: "failed",
  };
}

function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [page, setPage] = useState<PageName>("chat");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [messages, setMessages] = useState<Message[]>(window.blendyApp ? [] : seedMessages);
  const [contextSnapshot, setContextSnapshot] = useState<ContextSnapshot>(mockContextSnapshot);
  const [backendSettings, setBackendSettings] = useState<BackendSettings>(defaultBackendSettings);
  const [modelStatus, setModelStatus] = useState<ModelStatus | undefined>(undefined);
  const [projectNotebook, setProjectNotebook] = useState<ProjectNotebook>({ text: "" });
  const [notebookDraft, setNotebookDraft] = useState("");
  const [notebookSaving, setNotebookSaving] = useState(false);
  const [notebookSaved, setNotebookSaved] = useState(true);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [referenceError, setReferenceError] = useState("");
  const [generationStage, setGenerationStage] = useState<{ stage: string; label: string } | undefined>(undefined);
  const [chatPath, setChatPath] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isManagingContext, setIsManagingContext] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [editingChatId, setEditingChatId] = useState("");
  const [editingChatTitle, setEditingChatTitle] = useState("");
  const [confirmingDeleteChatId, setConfirmingDeleteChatId] = useState("");
  const [openReceipt, setOpenReceipt] = useState<{ message: Message; receipt: AssistantReceipt } | null>(null);
  const [latestDone, setLatestDone] = useState(false);
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const contextControlRef = useRef<HTMLDivElement | null>(null);
  const messageNodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const autoFollowRef = useRef(true);
  const activeGeneratedMessageIdRef = useRef<string | null>(null);
  const activeChatIdRef = useRef("");
  const backendSettingsRef = useRef(backendSettings);
  const lastSubmittedPromptRef = useRef("");
  const promptRef = useRef("");
  const notebookSavedRef = useRef(true);
  const generatedSnapTokenRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const messageSignatureRef = useRef("");
  const savedChatScrollTopRef = useRef(0);
  const restoreChatScrollRef = useRef(false);

  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    notebookSavedRef.current = notebookSaved;
  }, [notebookSaved]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    backendSettingsRef.current = backendSettings;
  }, [backendSettings]);

  useEffect(() => {
    if (modelStatus?.vision === false && referenceImages.length) {
      setReferenceImages([]);
      setReferenceError("The loaded model cannot read images. Use scene data or load a vision-capable model.");
    }
  }, [modelStatus?.vision, referenceImages.length]);

  useEffect(() => {
    const themeFont = settings.theme === "sprint" ? "fraktion" : "geist";
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.font = themeFont;
    document.documentElement.style.setProperty("--app-font-size", `${settings.textSize}px`);
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.blendyWindow?.getPinned().then(setPinned).catch(() => setPinned(true));
  }, []);

  useEffect(() => {
    if (!window.blendyApp) {
      return;
    }

    let cancelled = false;
    window.blendyApp
      .getState()
      .then((state) => {
        if (cancelled) {
          return;
        }
        setContextSnapshot(state.context);
        setBackendSettings({ ...defaultBackendSettings, ...state.backendSettings });
        if (state.modelStatus) {
          setModelStatus(state.modelStatus);
        }
        if (state.projectNotebook) {
          setProjectNotebook(state.projectNotebook);
          setNotebookDraft(state.projectNotebook.text || "");
          setNotebookSaved(true);
        }
        applyDiagnostics(state.diagnostics);
        setMessages(state.messages);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setContextSnapshot((current) => ({
          ...current,
          bridgeOk: false,
          bridgeStatus: error instanceof Error ? error.message : String(error),
        }));
      });

    window.blendyApp
      .getModelStatus?.()
      .then((status) => {
        if (!cancelled) setModelStatus(status);
      })
      .catch(() => undefined);

    const unsubscribe = window.blendyApp.onChatEvent((event) => {
      handleChatEvent(event);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const signature = messages
      .map((message) => `${message.id}:${message.status || ""}:${message.content.length}`)
      .join("|");
    const previousSignature = messageSignatureRef.current;
    messageSignatureRef.current = signature;

    const activeGeneratedMessageId = activeGeneratedMessageIdRef.current;
    if (activeGeneratedMessageId) {
      const activeMessage = messages.find((message) => message.id === activeGeneratedMessageId);
      if (activeMessage) {
        scheduleGeneratedReplySnap(
          activeGeneratedMessageId,
          activeMessage.status === "done" || activeMessage.status === "failed" || activeMessage.status === "cancelled",
        );
        if (activeMessage.status === "done" || activeMessage.status === "failed" || activeMessage.status === "cancelled") {
          activeGeneratedMessageIdRef.current = null;
        }
        return;
      }
    }

    const node = scrollRef.current;
    if (!messages.length && node) {
      node.scrollTop = 0;
      autoFollowRef.current = true;
      setShowJumpLatest(false);
      return;
    }
    if (autoFollowRef.current && node) {
      node.scrollTop = node.scrollHeight;
      setShowJumpLatest(false);
      return;
    }
    if (previousSignature && previousSignature !== signature) {
      setShowJumpLatest(true);
    }
  }, [messages]);

  useEffect(() => {
    if (!contextMenuOpen && !chatMenuOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const node = contextControlRef.current;
      if (!node || node.contains(event.target as Node)) {
        return;
      }
      setContextMenuOpen(false);
      setChatMenuOpen(false);
      setEditingChatId("");
      setConfirmingDeleteChatId("");
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [contextMenuOpen, chatMenuOpen]);

  useEffect(() => {
    if (!drawerOpen && !contextMenuOpen && !chatMenuOpen) return;
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setDrawerOpen(false);
      setContextMenuOpen(false);
      setChatMenuOpen(false);
      setEditingChatId("");
      setConfirmingDeleteChatId("");
      requestComposerFocus();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [chatMenuOpen, contextMenuOpen, drawerOpen]);

  function applyDiagnostics(diagnostics?: {
    chatPath?: string;
    activeChatId?: string;
    chatSessions?: ChatSession[];
  }) {
    if (!diagnostics) {
      return;
    }
    if (diagnostics.chatPath) {
      setChatPath(diagnostics.chatPath);
    }
    const nextSessions = Array.isArray(diagnostics.chatSessions) ? diagnostics.chatSessions : undefined;
    if (nextSessions) {
      setChatSessions(nextSessions);
    }
    if (diagnostics.activeChatId !== undefined || nextSessions) {
      setActiveChatId((current) => {
        const requested = diagnostics.activeChatId !== undefined ? diagnostics.activeChatId : current;
        if (nextSessions?.length && !nextSessions.some((session) => session.id === requested)) {
          return nextSessions[0].id;
        }
        return requested || nextSessions?.[0]?.id || "";
      });
    }
  }

  function focusComposerSoon() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        promptInputRef.current?.focus();
      });
    });
  }

  function requestComposerFocus() {
    setComposerFocusRequest((request) => request + 1);
  }

  useEffect(() => {
    if (!composerFocusRequest || page !== "chat" || isManagingContext) {
      return;
    }
    focusComposerSoon();
  }, [activeChatId, composerFocusRequest, isManagingContext, page]);

  function updateSettings(partial: Partial<AppSettings>) {
    setSettings((current) => ({ ...current, ...partial }));
  }

  function updateBackendSettings(partial: Partial<BackendSettings>) {
    const next = { ...backendSettingsRef.current, ...partial };
    backendSettingsRef.current = next;
    setBackendSettings(next);
    window.blendyApp?.saveBackendSettings(next).catch(() => undefined);
  }

  function toggleSettingsPage() {
    if (page === "chat") {
      savedChatScrollTopRef.current = scrollRef.current?.scrollTop || 0;
      restoreChatScrollRef.current = true;
      setPage("settings");
      return;
    }
    setPage("chat");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scroller = scrollRef.current;
        if (!scroller || !restoreChatScrollRef.current) {
          return;
        }
        scroller.scrollTop = savedChatScrollTopRef.current;
        autoFollowRef.current = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 40;
        restoreChatScrollRef.current = false;
      });
    });
  }

  function registerMessageNode(id: string, node: HTMLElement | null) {
    if (node) {
      messageNodeRefs.current[id] = node;
      return;
    }
    delete messageNodeRefs.current[id];
  }

  function scrollMessageToTop(id: string): boolean {
    const scroller = scrollRef.current;
    const node = messageNodeRefs.current[id];
    if (!scroller || !node) {
      return false;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    programmaticScrollUntilRef.current = window.performance.now() + 160;
    scroller.scrollTop += nodeRect.top - scrollerRect.top;
    autoFollowRef.current = false;
    setShowJumpLatest(false);
    return true;
  }

  function beginGeneratedReplySnap(id: string) {
    activeGeneratedMessageIdRef.current = id;
    generatedSnapTokenRef.current += 1;
    scheduleGeneratedReplySnap(id, false);
  }

  function scheduleGeneratedReplySnap(id: string, isFinal: boolean) {
    const token = generatedSnapTokenRef.current;
    const delays = isFinal ? [0, 40, 120, 260, 520] : [0, 40, 140];
    delays.forEach((delay) => {
      window.setTimeout(() => {
        if (generatedSnapTokenRef.current !== token) {
          return;
        }
        window.requestAnimationFrame(() => {
          if (generatedSnapTokenRef.current !== token) {
            return;
          }
          scrollMessageToTop(id);
        });
      }, delay);
    });
  }

  function handleChatEvent(event: ChatEvent) {
    if (event.type === "assistant-stage") {
      activeGeneratedMessageIdRef.current = event.id;
      setGenerationStage({ stage: event.stage, label: event.label });
      return;
    }
    if (event.type === "assistant-delta") {
      setMessages((current) =>
        current.map((message) =>
          message.id === event.id
            ? {
                ...message,
                content: `${message.content || ""}${event.delta}`,
                status: "streaming",
              }
            : message,
        ),
      );
      return;
    }
    if (event.type === "assistant-done") {
      const normalized = normalizeEventReceipt(event.receipt, event.toolTrace, event.finishReason, event.sources);
      setMessages((current) =>
        current.map((message) =>
          message.id === event.id
            ? {
              ...message,
              content: event.content,
              receipt: {
                ...normalized.receipt,
                summary: normalized.receipt.summary || (normalized.receipt.toolTrace?.length
                  ? "Blendy checked current evidence before answering."
                  : "Blendy answered from the available local context."),
              },
              context: normalized.line || message.context,
              status: "done",
              }
            : message,
        ),
      );
      setIsGenerating(false);
      setGenerationStage(undefined);
      lastSubmittedPromptRef.current = "";
      setLatestDone(true);
      window.setTimeout(() => setLatestDone(false), 1500);
      refreshBackendState();
      return;
    }
    if (event.type === "assistant-cancelled") {
      setMessages((current) => current.map((message) => message.id === event.id
        ? { ...message, content: event.content || "Stopped. Your question is ready to edit and try again.", status: "cancelled" }
        : message));
      if (!promptRef.current.trim() && lastSubmittedPromptRef.current) setPrompt(lastSubmittedPromptRef.current);
      setIsGenerating(false);
      setGenerationStage(undefined);
      return;
    }
    setMessages((current) =>
      current.map((message) =>
        message.id === event.id
          ? {
              ...message,
              content: event.error,
              status: "failed",
            }
          : message,
      ),
    );
    if (!promptRef.current.trim() && lastSubmittedPromptRef.current) {
      setPrompt(lastSubmittedPromptRef.current);
    }
    setIsGenerating(false);
    setGenerationStage(undefined);
    setLatestDone(true);
    window.setTimeout(() => setLatestDone(false), 1500);
    refreshBackendState();
  }

  function refreshBackendState() {
    window.blendyApp
      ?.getState()
      .then((state) => {
        setContextSnapshot(state.context);
        setBackendSettings({ ...defaultBackendSettings, ...state.backendSettings });
        if (state.modelStatus) setModelStatus(state.modelStatus);
        if (state.projectNotebook) {
          setProjectNotebook(state.projectNotebook);
          if (notebookSavedRef.current) setNotebookDraft(state.projectNotebook.text || "");
        }
        applyDiagnostics(state.diagnostics);
      })
      .catch(() => undefined);
  }

  async function stopGeneration() {
    const messageId = activeGeneratedMessageIdRef.current;
    if (!messageId || !window.blendyApp?.cancelMessage) {
      return;
    }
    try {
      const result = await window.blendyApp.cancelMessage({ messageId });
      if (!result.ok) {
        setGenerationStage({ stage: "finishing", label: "Finishing the current response" });
        await refreshBackendState();
        return;
      }
      setGenerationStage({ stage: "stopping", label: "Stopping safely" });
    } catch (error) {
      setMessages((current) => [
        ...current,
        operationNotice("Stop request did not reach the model", error, "The answer is still running. Wait for it to finish, then try again."),
      ]);
      setGenerationStage({ stage: "thinking", label: "The local model is still working" });
    }
  }

  async function persistNotebookDraft() {
    const nextText = notebookDraft.trim();
    if (nextText === (projectNotebook.text || "").trim()) {
      setNotebookSaved(true);
      notebookSavedRef.current = true;
      return true;
    }
    if (!window.blendyApp?.saveChatNotebook) {
      return false;
    }
    const savingChatId = activeChatId;
    setNotebookSaving(true);
    try {
      const result = await window.blendyApp.saveChatNotebook({ chatId: savingChatId, text: nextText });
      const returned = result && "projectNotebook" in result ? result.projectNotebook : result;
      const nextNotebook: ProjectNotebook = returned && "text" in returned
        ? returned
        : { ...projectNotebook, text: nextText };
      if (activeChatIdRef.current === savingChatId) {
        setProjectNotebook(nextNotebook);
        setNotebookDraft(nextNotebook.text || "");
        setNotebookSaved(true);
        notebookSavedRef.current = true;
      }
      return true;
    } catch (error) {
      setNotebookSaved(false);
      notebookSavedRef.current = false;
      setMessages((current) => [
        ...current,
        operationNotice("Notebook was not saved", error, "Your text is still in the editor. Keep the workspace open and choose Save notebook again."),
      ]);
      return false;
    } finally {
      setNotebookSaving(false);
    }
  }

  async function saveNotebook() {
    await persistNotebookDraft();
  }

  async function keepChatForCurrentScene() {
    if (!window.blendyApp?.acknowledgeChatScene) {
      setMessages((current) => [
        ...current,
        operationNotice("Scene was not acknowledged", "This Blendy backend does not support scene acknowledgement.", "Restart Blendy after installing the current version."),
      ]);
      return;
    }
    try {
      const result = await window.blendyApp.acknowledgeChatScene({ chatId: activeChatId });
      const returned = result && "projectNotebook" in result ? result.projectNotebook : result;
      if (returned && "text" in returned) setProjectNotebook(returned);
    } catch (error) {
      setMessages((current) => [
        ...current,
        operationNotice("Scene was not acknowledged", error, "The warning remains accurate. Try Keep chat again after Blender is ready."),
      ]);
    }
  }

  async function addReferenceFiles(files: FileList) {
    setReferenceError("");
    const remaining = Math.max(0, 2 - referenceImages.length);
    if (!remaining) {
      setReferenceError("Remove a reference before adding another. The limit is two.");
      return;
    }
    const candidates = Array.from(files).slice(0, remaining);
    const invalid = candidates.find((file) => !inferReferenceMimeType(file.name, file.type));
    if (invalid) {
      setReferenceError(`${invalid.name} is not a supported photo. Choose a PNG, JPG, or WebP image.`);
      return;
    }
    const tooLarge = candidates.find((file) => file.size > MAX_REFERENCE_SOURCE_BYTES);
    if (tooLarge) {
      setReferenceError(`${tooLarge.name} is over 32 MB. Export a smaller copy, then try again.`);
      return;
    }
    try {
      const loaded = await Promise.all(candidates.map(async (file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        dataUrl: await prepareReferenceImage(file, inferReferenceMimeType(file.name, file.type)),
      })));
      setReferenceImages((current) => [...current, ...loaded].slice(0, 2));
      if (files.length > remaining) setReferenceError("Only the first two reference images were added.");
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : "Blendy could not read that image. Try another file.");
    }
  }

  async function togglePinned() {
    const next = !pinned;
    setPinned(next);
    const actual = await window.blendyWindow?.setPinned(next);
    if (typeof actual === "boolean") {
      setPinned(actual);
    }
  }

  function handleScroll() {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    if (window.performance.now() < programmaticScrollUntilRef.current) {
      return;
    }
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    autoFollowRef.current = distanceFromBottom < 80;
    if (autoFollowRef.current) {
      setShowJumpLatest(false);
    }
  }

  function jumpToLatest() {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    autoFollowRef.current = true;
    setShowJumpLatest(false);
    node.scrollTop = node.scrollHeight;
  }

  async function sendPrompt(promptOverride?: string) {
    const cleanPrompt = (promptOverride ?? prompt).trim();
    if (!cleanPrompt || isGenerating) {
      return;
    }

    if (promptOverride === undefined) setPrompt("");
    lastSubmittedPromptRef.current = cleanPrompt;
    setIsGenerating(true);
    setGenerationStage({ stage: "preparing", label: "Preparing scene context" });
    setLatestDone(false);

    if (!window.blendyApp) {
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Blendy backend is not available in this preview window.",
        status: "failed",
      };
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: cleanPrompt,
          context: "Used: preview mode",
        },
        assistantMessage,
      ]);
      setIsGenerating(false);
      setGenerationStage(undefined);
      return;
    }

    try {
      const result = await window.blendyApp.sendMessage({
        prompt: cleanPrompt,
        backendSettings,
        chatId: activeChatId,
        referenceImages: referenceImages.map((image) => image.dataUrl),
      });
      setContextSnapshot(result.context);
      if (result.modelStatus) setModelStatus(result.modelStatus);
      if (result.projectNotebook) {
        setProjectNotebook(result.projectNotebook);
        if (notebookSavedRef.current) setNotebookDraft(result.projectNotebook.text || "");
      }
      applyDiagnostics(result.diagnostics);
      beginGeneratedReplySnap(result.assistantMessage.id);
      setGenerationStage({ stage: "thinking", label: "Reading your project" });
      setReferenceImages([]);
      setReferenceError("");
      if (result.messages) {
        setMessages(result.messages);
      } else {
        setMessages((current) => [
          ...current,
          ...(result.userMessage ? [result.userMessage] : []),
          result.assistantMessage,
        ]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!promptRef.current.trim()) setPrompt(cleanPrompt);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: message,
          status: "failed",
        },
      ]);
      setIsGenerating(false);
      setGenerationStage(undefined);
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") {
      return;
    }
    if (event.shiftKey) {
      return;
    }
    event.preventDefault();
    sendPrompt();
  }

  async function regenerateLatest() {
    if (isGenerating) {
      return;
    }
    if (!window.blendyApp) {
      return;
    }
    setIsGenerating(true);
    setGenerationStage({ stage: "preparing", label: "Preparing a new answer" });
    setLatestDone(false);
    try {
      const result = await window.blendyApp.regenerateLast({
        backendSettings,
        chatId: activeChatId,
      });
      setContextSnapshot(result.context);
      if (result.modelStatus) setModelStatus(result.modelStatus);
      if (result.projectNotebook) setProjectNotebook(result.projectNotebook);
      applyDiagnostics(result.diagnostics);
      beginGeneratedReplySnap(result.assistantMessage.id);
      setMessages((current) => result.messages?.length ? result.messages : [...current, result.assistantMessage]);
      setGenerationStage({ stage: "thinking", label: "Reading your project" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: message,
          status: "failed",
        },
      ]);
      setIsGenerating(false);
      setGenerationStage(undefined);
    }
  }

  async function compactNow() {
    if (!window.blendyApp || isGenerating || isManagingContext || notebookSaving) {
      return;
    }
    setContextMenuOpen(false);
    setIsManagingContext(true);
    try {
      if (!(await persistNotebookDraft())) return;
      const result = await window.blendyApp.compactChat({ backendSettings });
      setMessages(result.messages);
      setContextSnapshot(result.context);
      if (result.modelStatus) setModelStatus(result.modelStatus);
      if (result.projectNotebook) {
        setProjectNotebook(result.projectNotebook);
        setNotebookDraft(result.projectNotebook.text || "");
        setNotebookSaved(true);
      }
      applyDiagnostics(result.diagnostics);
    } catch (error) {
      setMessages((current) => [
        ...current,
        operationNotice("Conversation was not compacted", error, "Your chat is unchanged. Open the context menu and choose Compact now again."),
      ]);
    } finally {
      setIsManagingContext(false);
    }
  }

  async function freshChat() {
    if (!window.blendyApp || isGenerating || isManagingContext || notebookSaving) {
      return;
    }
    setChatMenuOpen(false);
    setContextMenuOpen(false);
    setEditingChatId("");
    setConfirmingDeleteChatId("");
    setIsManagingContext(true);
    try {
      if (!(await persistNotebookDraft())) return;
      const result = await window.blendyApp.freshChat({ backendSettings });
      setMessages(result.messages);
      setContextSnapshot(result.context);
      if (result.modelStatus) setModelStatus(result.modelStatus);
      const nextNotebook = result.projectNotebook || { text: "" };
      setProjectNotebook(nextNotebook);
      setNotebookDraft(nextNotebook.text || "");
      setNotebookSaved(true);
      setReferenceImages([]);
      setReferenceError("");
      applyDiagnostics(result.diagnostics);
      setContextMenuOpen(false);
      setEditingChatId("");
      setPrompt("");
      requestComposerFocus();
    } catch (error) {
      setMessages((current) => [
        ...current,
        operationNotice("New chat was not created", error, "Your current chat is unchanged. Open Chat history and choose New again."),
      ]);
    } finally {
      setIsManagingContext(false);
    }
  }

  async function switchChat(chatId: string) {
    if (!window.blendyApp || isGenerating || isManagingContext || notebookSaving || chatId === activeChatId) {
      setChatMenuOpen(false);
      return;
    }
    setChatMenuOpen(false);
    setContextMenuOpen(false);
    setEditingChatId("");
    setConfirmingDeleteChatId("");
    setIsManagingContext(true);
    try {
      if (!(await persistNotebookDraft())) return;
      const result = await window.blendyApp.switchChat({ chatId, backendSettings });
      setMessages(result.messages);
      setContextSnapshot(result.context);
      if (result.modelStatus) setModelStatus(result.modelStatus);
      const nextNotebook = result.projectNotebook || { text: "" };
      setProjectNotebook(nextNotebook);
      setNotebookDraft(nextNotebook.text || "");
      setNotebookSaved(true);
      setReferenceImages([]);
      setReferenceError("");
      applyDiagnostics(result.diagnostics);
      setPrompt("");
      requestComposerFocus();
      window.requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (node) {
          node.scrollTop = node.scrollHeight;
          autoFollowRef.current = true;
        }
      });
    } catch (error) {
      setMessages((current) => [
        ...current,
        operationNotice("Chat did not switch", error, "Your current chat is still open. Open Chat history and select the other chat again."),
      ]);
    } finally {
      setIsManagingContext(false);
    }
  }

  function beginRenameChat(session: ChatSession) {
    setConfirmingDeleteChatId("");
    setEditingChatId(session.id);
    setEditingChatTitle(session.title);
  }

  async function commitRenameChat(chatId: string) {
    const title = editingChatTitle.trim();
    if (!window.blendyApp || !title) {
      setEditingChatId("");
      return;
    }
    try {
      const result = await window.blendyApp.renameChat({ chatId, title });
      applyDiagnostics(result.diagnostics);
      setEditingChatId("");
      setEditingChatTitle("");
    } catch (error) {
      setMessages((current) => [
        ...current,
        operationNotice("Chat was not renamed", error, "The old name is unchanged. Open Chat history and try the rename again."),
      ]);
      setEditingChatId("");
    }
  }

  async function deleteChat(chatId: string) {
    if (!window.blendyApp || isGenerating || isManagingContext || notebookSaving) {
      return;
    }
    if (confirmingDeleteChatId !== chatId) {
      setEditingChatId("");
      setConfirmingDeleteChatId(chatId);
      return;
    }
    setChatMenuOpen(false);
    setContextMenuOpen(false);
    setEditingChatId("");
    setConfirmingDeleteChatId("");
    setIsManagingContext(true);
    try {
      if (!(await persistNotebookDraft())) return;
      const result = await window.blendyApp.deleteChat({ chatId, backendSettings });
      setMessages(result.messages);
      setContextSnapshot(result.context);
      if (result.modelStatus) setModelStatus(result.modelStatus);
      const nextNotebook = result.projectNotebook || { text: "" };
      setProjectNotebook(nextNotebook);
      setNotebookDraft(nextNotebook.text || "");
      setNotebookSaved(true);
      setReferenceImages([]);
      setReferenceError("");
      applyDiagnostics(result.diagnostics);
      setPrompt("");
      requestComposerFocus();
    } catch (error) {
      setMessages((current) => [
        ...current,
        operationNotice("Chat was not deleted", error, "Nothing was removed. Open Chat history and confirm Delete again."),
      ]);
    } finally {
      setIsManagingContext(false);
    }
  }

  async function captureViewport() {
    if (!window.blendyApp) {
      return;
    }
    try {
      const context = await window.blendyApp.refreshContext({ forceScreenshot: true, chatId: activeChatId });
      setContextSnapshot(context);
    } catch (error) {
      setMessages((current) => [
        ...current,
        operationNotice("Screen was not captured", error, "Keep Blender visible, then open the workspace and choose Capture screen again."),
      ]);
    }
  }

  async function openPromptPacket() {
    if (!window.blendyApp || !contextSnapshot.promptPacketPath) {
      return;
    }
    const result = await window.blendyApp.openDiagnosticFile(contextSnapshot.promptPacketPath).catch((error) => ({ ok: false, error: String(error) }));
    if (!result.ok) {
      setMessages((current) => [
        ...current,
        operationNotice("Diagnostics did not open", result.error, "Nothing changed. Return to Settings and choose Diagnostics again."),
      ]);
    }
  }

  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.status === "done" && message.content.trim());

  const headerChatControls = (
    <div className="header-chat-controls" ref={contextControlRef}>
      {isGenerating && Boolean(activeGeneratedMessageIdRef.current) ? (
        <button type="button" className="stop-generation" onClick={stopGeneration} title={generationStage?.label || "Stop generation"}>
          <Square size={13} fill="currentColor" />
          Stop
        </button>
      ) : null}
      <div className="context-control">
        <button
          className="context-usage-button"
          type="button"
          onClick={() => {
            setContextMenuOpen((open) => !open);
            setChatMenuOpen(false);
          }}
          disabled={isGenerating || isManagingContext}
          title={contextButtonLabel(contextSnapshot)}
          aria-label={contextButtonLabel(contextSnapshot)}
        >
          <Info size={15} />
        </button>
        {contextMenuOpen && (
          <div className="context-menu">
            <div className="context-menu-meter">
              <span>{formatTokens(contextSnapshot.contextTokens || 0)}</span>
              <strong>{contextSnapshot.contextPercent || 0}%</strong>
            </div>
            <div className="context-menu-bar">
              <span style={{ width: `${Math.min(100, contextSnapshot.contextPercent || 0)}%` }} />
            </div>
            <div className="context-menu-breakdown">
              <div>
                <span>Base context</span>
                <strong>{formatTokens(contextSnapshot.baselineTokens || 0)}</strong>
              </div>
              <div>
                <span>Conversation</span>
                <strong>{formatTokens(contextSnapshot.conversationTokens || 0)}</strong>
              </div>
              <div>
                <span>Tools</span>
                <strong>{formatTokens((contextSnapshot.toolDefinitionTokens || 0) + (contextSnapshot.toolReserveTokens || 0))}</strong>
              </div>
              <div>
                <span>Screenshot</span>
                <strong>{formatTokens(contextSnapshot.imageReserveTokens || 0)}</strong>
              </div>
              <div>
                <span>Remaining</span>
                <strong>{formatTokens(Math.max(0, (contextSnapshot.contextLimitTokens || 0) - (contextSnapshot.contextTokens || 0)))}</strong>
              </div>
            </div>
            <p className="context-menu-note">Compact shrinks conversation history. Tools and screenshot reserve are counted because the local model may need them inside the same answer.</p>
            <button type="button" onClick={compactNow} disabled={isManagingContext}>
              Compact now
            </button>
          </div>
        )}
      </div>
      <div className="chat-history-control">
        <button
          className="chat-history-button"
          type="button"
          onClick={() => {
            setChatMenuOpen((open) => !open);
            setContextMenuOpen(false);
          }}
          disabled={isGenerating || isManagingContext}
          title="Chat history"
          aria-label="Chat history"
        >
          <Menu size={15} />
        </button>
        {chatMenuOpen && (
          <div className="chat-history-menu">
            <div className="chat-history-head">
              <span>Chat history</span>
              <button type="button" onClick={freshChat} disabled={isManagingContext}>
                New
              </button>
            </div>
            <div className="chat-history-list">
              {chatSessions.map((session) => (
                <div className={`chat-history-row ${session.id === activeChatId ? "active" : ""}`} key={session.id}>
                  {editingChatId === session.id ? (
                    <form
                      className="chat-rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        commitRenameChat(session.id);
                      }}
                    >
                      <input
                        value={editingChatTitle}
                        onChange={(event) => setEditingChatTitle(event.target.value)}
                        autoFocus
                      />
                      <button type="submit" aria-label="Save chat name">
                        <Check size={14} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button className="chat-history-title" type="button" onClick={() => switchChat(session.id)}>
                        <span>{session.title}</span>
                        <small>{new Date(session.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
                      </button>
                      <button className="chat-history-icon" type="button" onClick={() => beginRenameChat(session)} aria-label="Rename chat">
                        <Pencil size={13} />
                      </button>
                      <button
                        className={`chat-history-icon danger ${confirmingDeleteChatId === session.id ? "confirm" : ""}`}
                        type="button"
                        onClick={() => deleteChat(session.id)}
                        aria-label={confirmingDeleteChatId === session.id ? "Confirm delete chat" : "Delete chat"}
                        title={confirmingDeleteChatId === session.id ? "Click again to delete" : "Delete chat"}
                      >
                        {confirmingDeleteChatId === session.id ? <X size={13} /> : <Trash2 size={13} />}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="app-window">
      <header className="titlebar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="" />
          <div>
            <div className="brand-name">Blendy Studio Coach</div>
            <div className="brand-subtitle">Local Blender guidance</div>
          </div>
        </div>

        <div className="window-actions">
          <button className="icon-button" type="button" onClick={togglePinned} title={pinned ? "Unpin window" : "Pin window"}>
            {pinned ? <Pin size={16} /> : <PinOff size={16} />}
          </button>
          {page === "chat" && (
            <button className="icon-button" type="button" onClick={() => setDrawerOpen((open) => !open)} title="Project workspace" aria-expanded={drawerOpen} aria-controls="project-workspace">
              <PanelRight size={17} />
            </button>
          )}
          {page === "chat" && headerChatControls}
          <button
            className="icon-button"
            type="button"
            onClick={toggleSettingsPage}
            title={page === "settings" ? "Back to chat" : "Settings"}
          >
            {page === "settings" ? <ChevronLeft size={17} /> : <Settings size={17} />}
          </button>
          <button className="icon-button window-control" type="button" onClick={() => window.blendyWindow?.minimize()} title="Minimize">
            <Minus size={16} />
          </button>
          <button className="icon-button window-control danger" type="button" onClick={() => window.blendyWindow?.close()} title="Close">
            <X size={16} />
          </button>
        </div>
      </header>

      {page === "settings" ? (
        <SettingsPage
          settings={settings}
          updateSettings={updateSettings}
          backendSettings={backendSettings}
          updateBackendSettings={updateBackendSettings}
          contextSnapshot={contextSnapshot}
          modelStatus={modelStatus}
          chatPath={chatPath}
          onOpenPromptPacket={openPromptPacket}
        />
      ) : (
        <main className={`chat-layout ${drawerOpen ? "drawer-open" : ""}`}>
          <section className="chat-page" aria-hidden={drawerOpen || undefined}>
            <SceneMismatchBanner notebook={projectNotebook} onKeep={keepChatForCurrentScene} onNewChat={freshChat} />
            <div className="messages" ref={scrollRef} onScroll={handleScroll}>
              {messages.length === 0 ? (
                <EmptyStudioState
                  onStarter={(starter) => {
                    setPrompt(starter);
                    requestComposerFocus();
                  }}
                />
              ) : (
                messages.map((message, index) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    isLatestAssistant={message.role === "assistant" && index === messages.length - 1}
                    onRegenerate={regenerateLatest}
                    onReceiptClick={(target) => {
                      if (target.receipt) {
                        setOpenReceipt({ message: target, receipt: target.receipt });
                      }
                    }}
                    registerMessageNode={registerMessageNode}
                  />
                ))
              )}
            </div>
            <div className="coach-dock">
              {showJumpLatest && (
                <button className="jump-latest" type="button" onClick={jumpToLatest}>
                  New text
                </button>
              )}
              <footer className="composer">
                <ReferenceAttachmentTray
                  images={referenceImages}
                  error={referenceError}
                  supportsVision={modelStatus?.vision !== false}
                  onChoose={addReferenceFiles}
                  onRemove={(id) => setReferenceImages((current) => current.filter((image) => image.id !== id))}
                  actions={latestAssistant ? <CurrentCheckpoint disabled={isGenerating} onFollowUp={sendPrompt} /> : undefined}
                />
                <div className="composer-input-row">
                  <textarea
                    ref={promptInputRef}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={handlePromptKeyDown}
                    placeholder={contextSnapshot.bridgeOk === false ? "Ask a general Blender question..." : "Describe what you want to make or ask what comes next..."}
                    rows={2}
                  />
                  <button className="send-button" type="button" onClick={() => sendPrompt()} disabled={!prompt.trim() || isGenerating} aria-label="Send message">
                    <Send size={17} />
                  </button>
                </div>
              </footer>
            </div>
          </section>

          {drawerOpen && (
            <ContextDrawer
              contextSnapshot={contextSnapshot}
              onCaptureViewport={captureViewport}
              notebookDraft={notebookDraft}
              notebookSaved={notebookSaved}
              notebookSaving={notebookSaving}
              onNotebookChange={(value) => {
                setNotebookDraft(value);
                setNotebookSaved(value.trim() === (projectNotebook.text || "").trim());
              }}
              onNotebookSave={saveNotebook}
              onClose={() => setDrawerOpen(false)}
            />
          )}
        </main>
      )}
      {openReceipt && (
        <ReceiptDetails
          message={openReceipt.message}
          receipt={openReceipt.receipt}
          onClose={() => setOpenReceipt(null)}
        />
      )}
    </div>
  );
}

interface MessageRowProps {
  message: Message;
  isLatestAssistant: boolean;
  onRegenerate: () => void;
  onReceiptClick: (message: Message) => void;
  registerMessageNode: (id: string, node: HTMLElement | null) => void;
}

function retryLabelFor(error: string) {
  if (/lm studio|load(?:ed)? model|no model/i.test(error)) return "Retry after loading model";
  if (/blender|bridge|scene/i.test(error)) return "Retry Blender check";
  if (/timed out|timeout/i.test(error)) return "Retry timed-out step";
  if (/stopp?ed|cancel/i.test(error)) return "Start again";
  return "Try again";
}

function MessageRow({ message, isLatestAssistant, onRegenerate, onReceiptClick, registerMessageNode }: MessageRowProps) {
  if (message.role === "event" && message.marker === "compacted") {
    return (
      <div className="conversation-marker">
        <span />
        <strong>Conversation compacted</strong>
        <span />
      </div>
    );
  }

  if (message.role === "event" && message.status === "failed") {
    const [title, detail, recovery] = message.content.split("\n");
    return (
      <article ref={(node) => registerMessageNode(message.id, node)} className="operation-notice" role="alert">
        <Info size={17} />
        <div>
          <strong>{title || "That action did not finish"}</strong>
          {detail && <p>{detail}</p>}
          {recovery && <small>{recovery}</small>}
        </div>
      </article>
    );
  }

  return (
    <article
      ref={(node) => registerMessageNode(message.id, node)}
      className={`message-row ${message.role} ${message.status || ""}`}
      aria-live={message.status === "streaming" ? "polite" : undefined}
    >
      <div className="message-label">{message.role === "user" ? "You" : "Blendy"}</div>
      <div className="message-content">
        {message.content ? (
          message.content.split("\n").map((line, lineIndex) => <p key={`${message.id}-${lineIndex}`}>{line}</p>)
        ) : (
          <div className="typing-line">
            <Sparkles size={15} />
            Thinking...
          </div>
        )}
      </div>
      {message.role === "assistant" && message.receipt ? (
        <button
          className="used-context assistant-receipt"
          type="button"
          onClick={() => onReceiptClick(message)}
        >
          {message.context || "View evidence used for this answer"}
        </button>
      ) : message.context ? <div className="used-context static-context">{message.context}</div> : null}
      {(message.status === "failed" || message.status === "cancelled") && (
        <div className="failure-recovery">
          <small>{message.status === "cancelled" ? "Generation stopped. Your question is back in the composer." : "Your question is still available to edit. Nothing was lost."}</small>
          <button className="inline-action" type="button" onClick={onRegenerate}>
            <RefreshCcw size={14} />
            {retryLabelFor(message.content)}
          </button>
        </div>
      )}
      {isLatestAssistant && message.status === "done" && (
        <button className="inline-action" type="button" onClick={onRegenerate}>
          <RefreshCcw size={14} />
          Regenerate
        </button>
      )}
    </article>
  );
}

function cleanReceiptText(value?: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, "; ")
    .trim()
    .replace(/[.?!]+$/g, "");
}

function receiptCardLabel(type?: string) {
  if (type === "workflow_shortcut") return "Workflow shortcut";
  if (type === "troubleshooting") return "Troubleshooting card";
  return "Reference card";
}

function summarizeReceiptCard(card: NonNullable<AssistantReceipt["cards"]>[number]) {
  if (card.plainSummary) return card.plainSummary;
  const betterMove = cleanReceiptText(card.betterMove);
  const diagnosisOrder = cleanReceiptText(card.diagnosisOrder);
  const reason = cleanReceiptText((card.reasons || [])[0]);
  const title = cleanReceiptText(card.title || "selected card");
  const plainPoint = betterMove || diagnosisOrder || reason || title;

  if (card.type === "workflow_shortcut") {
    return `Blendy used a workflow shortcut: ${plainPoint}.`;
  }
  if (card.type === "troubleshooting") {
    return `Blendy used a troubleshooting card: ${plainPoint}.`;
  }
  return `Blendy used this reference because it matched the situation: ${plainPoint}.`;
}

function ReceiptDetails({
  message,
  receipt,
  onClose,
}: {
  message: Message;
  receipt: AssistantReceipt;
  onClose: () => void;
}) {
  const cards = receipt.cards || [];
  const trace = receipt.toolTrace || [];
  const usedQueries = receipt.web?.usedQueries || [];
  const attemptedQueries = receipt.web?.queries || [];
  const webQuery = usedQueries[0] || attemptedQueries[0] || "";
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button, summary, a[href], input, textarea, [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, []);

  const evidence = [
    receipt.usedScene || trace.some((entry) => entry.sceneUsed || /scene|context/i.test(entry.call?.name || entry.name || "")) ? "Current Blender scene" : "",
    receipt.usedScreenshot || trace.some((entry) => entry.screenshotUsed || /screen|visual|image/i.test(entry.call?.name || entry.name || "")) ? "Fresh screen capture" : "",
    trace.length ? `${trace.length} tool check${trace.length === 1 ? "" : "s"}` : "",
    receipt.safety ? `Safety: ${receipt.safety}` : "",
  ].filter(Boolean);
  return (
    <div className="receipt-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={panelRef} className="receipt-panel" role="dialog" aria-modal="true" aria-label="What Blendy checked" onMouseDown={(event) => event.stopPropagation()}>
        <div className="receipt-head">
          <div>
            <h2>What Blendy checked</h2>
            <p>{receipt.summary || message.context || "Evidence used for this answer"}</p>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close receipt">
            <X size={15} />
          </button>
        </div>

        <section className="receipt-evidence" aria-label="Evidence summary">
          {evidence.length ? evidence.map((item) => <span key={item}><Check size={14} /> {item}</span>) : <p>No live checks were needed for this answer.</p>}
        </section>

        {cards.length > 0 && (
          <section className="receipt-section">
            <h3>What Blendy Used</h3>
            {cards.map((card) => (
              <article className="receipt-card" key={card.id || card.title}>
                <div>
                  <strong>{receiptCardLabel(card.type)}</strong>
                  {card.title && <span>{card.title}</span>}
                </div>
                <p>{summarizeReceiptCard(card)}</p>
              </article>
            ))}
          </section>
        )}

        {(receipt.web?.status || webQuery) && (
          <section className="receipt-section">
            <h3>Web Check</h3>
            {webQuery ? (
              <p className="receipt-status">Blendy checked web results for: {webQuery}</p>
            ) : (
              <p className="receipt-status">{receipt.web?.status}</p>
            )}
          </section>
        )}

        {(receipt.sources || []).length > 0 && (
          <section className="receipt-section">
            <h3>Sources</h3>
            {(receipt.sources || []).map((source, index) => source.url ? (
              <a className="receipt-source" key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">
                <strong>{source.title || source.host || "Reference"}</strong>
                <span>{source.url}</span>
              </a>
            ) : null)}
          </section>
        )}

        {!cards.length && !trace.length && !receipt.web?.status && !webQuery && (
          <p className="receipt-empty">No detailed receipt data was stored for this message.</p>
        )}

        <details className="receipt-diagnostics">
          <summary>Technical details</summary>
          <div>
            {trace.map((entry, index) => (
              <article className="receipt-trace" key={`${entry.call?.name || entry.name || "tool"}-${index}`}>
                <strong>{entry.call?.name || entry.name || "Local check"}</strong>
                <span>{entry.status || (entry.ok === false ? "failed" : "completed")}</span>
                {(entry.resultPreview || entry.summary) && <p>{entry.resultPreview || entry.summary}</p>}
                {entry.safety && <small>Safety: {entry.safety}</small>}
              </article>
            ))}
            <DataLine label="Finish reason" value={receipt.finishReason || "complete"} />
            <DataLine label="Stored context" value={message.context || "None"} />
          </div>
        </details>
      </section>
    </div>
  );
}

function ContextDrawer({
  contextSnapshot,
  onCaptureViewport,
  notebookDraft,
  notebookSaved,
  notebookSaving,
  onNotebookChange,
  onNotebookSave,
  onClose,
}: {
  contextSnapshot: ContextSnapshot;
  onCaptureViewport: () => void;
  notebookDraft: string;
  notebookSaved: boolean;
  notebookSaving: boolean;
  onNotebookChange: (value: string) => void;
  onNotebookSave: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"notebook" | "scene">("notebook");
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    function handleDrawerKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>("button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleDrawerKeyDown);
    return () => {
      window.removeEventListener("keydown", handleDrawerKeyDown);
      previous?.focus();
    };
  }, []);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = tab === "notebook" ? "scene" : "notebook";
    setTab(next);
    window.requestAnimationFrame(() => {
      drawerRef.current?.querySelector<HTMLButtonElement>(`[role="tab"][data-tab="${next}"]`)?.focus();
    });
  }
  return (
    <aside id="project-workspace" ref={drawerRef} className="context-drawer" role="dialog" aria-modal="true" aria-label="Project workspace">
      <div className="drawer-header">
        <div>
          <h2>Project workspace</h2>
          <p>Notes and current Blender evidence</p>
        </div>
        <button ref={closeRef} className="drawer-close" type="button" onClick={onClose} title="Close project workspace" aria-label="Close project workspace">
          <X size={15} />
        </button>
      </div>

      <div className="drawer-tabs" role="tablist" aria-label="Project workspace sections">
        <button id="workspace-tab-notebook" data-tab="notebook" type="button" role="tab" aria-selected={tab === "notebook"} aria-controls="workspace-panel-notebook" tabIndex={tab === "notebook" ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => setTab("notebook")}>Notebook</button>
        <button id="workspace-tab-scene" data-tab="scene" type="button" role="tab" aria-selected={tab === "scene"} aria-controls="workspace-panel-scene" tabIndex={tab === "scene" ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => setTab("scene")}>Blender scene</button>
      </div>

      {tab === "notebook" ? (
        <div id="workspace-panel-notebook" role="tabpanel" aria-labelledby="workspace-tab-notebook">
          <ProjectNotebookEditor
            value={notebookDraft}
            saved={notebookSaved}
            saving={notebookSaving}
            onChange={onNotebookChange}
            onSave={onNotebookSave}
          />
        </div>
      ) : (
        <div id="workspace-panel-scene" role="tabpanel" aria-labelledby="workspace-tab-scene">

      <ContextSection icon={<SlidersHorizontal size={16} />} title="Selected">
        <DataLine label="Object" value={contextSnapshot.selectedObject} />
        <DataLine label="Mode" value={contextSnapshot.mode} />
        <DataLine label="Units" value={contextSnapshot.units} />
        <DataLine label="Dimensions" value={contextSnapshot.dimensions} />
        <DataLine label="Scale" value={contextSnapshot.scale} />
      </ContextSection>

      <ContextSection icon={<Sparkles size={16} />} title="Modifiers">
        {contextSnapshot.modifiers.map((modifier) => (
          <DataLine key={modifier.name} label={modifier.name} value={modifier.detail} />
        ))}
      </ContextSection>

      <ContextSection icon={<Eye size={16} />} title="Scene">
        <DataLine label="Blender" value={contextSnapshot.blenderVersion || "Unknown"} />
        <DataLine label="Project" value={contextSnapshot.project} />
        <DataLine label="Scene" value={contextSnapshot.scene} />
        <DataLine label="Materials" value={contextSnapshot.materials.join(", ")} />
      </ContextSection>

      <ContextSection icon={<Image size={16} />} title="Visual">
        <p className="drawer-copy">{contextSnapshot.visual}</p>
        <button className="secondary-button" type="button" onClick={onCaptureViewport}>Capture screen</button>
      </ContextSection>

        </div>
      )}
    </aside>
  );
}

function ContextSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="context-section">
      <h3>
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="data-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingsPage({
  settings,
  updateSettings,
  backendSettings,
  updateBackendSettings,
  contextSnapshot,
  modelStatus,
  chatPath,
  onOpenPromptPacket,
}: {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  backendSettings: BackendSettings;
  updateBackendSettings: (partial: Partial<BackendSettings>) => void;
  contextSnapshot: ContextSnapshot;
  modelStatus?: ModelStatus;
  chatPath: string;
  onOpenPromptPacket: () => void;
}) {
  return (
    <main className="settings-page">
      <section className="settings-hero">
        <div>
          <h1>Settings</h1>
          <p>Tune the window, model behavior, and how Blendy grounds answers in Blender.</p>
        </div>
      </section>

      <SettingsGroup title="Appearance">
        <SegmentedControl
          label="Theme"
          value={settings.theme}
          options={[
            ["solar", themeLabels.solar],
            ["sprint", themeLabels.sprint],
          ]}
          onChange={(theme) => updateSettings({ theme: theme as ThemeName })}
        />
        <label className="range-setting">
          <span>Text size</span>
          <strong>{settings.textSize}px</strong>
          <input
            type="range"
            min="14"
            max="20"
            step="1"
            value={settings.textSize}
            onChange={(event) => updateSettings({ textSize: Number(event.target.value) })}
          />
        </label>
      </SettingsGroup>

      <SettingsGroup title="Tools">
        <SegmentedControl
          label="Tool use"
          value={backendSettings.toolUse}
          options={[
            ["AUTO", "Auto"],
            ["OFF", "Off"],
          ]}
          onChange={(toolUse) => updateBackendSettings({ toolUse: toolUse as ToolUseMode })}
        />
        <p className="setting-note">Blendy lets the local model request docs, workflow notes, and web lookup tools when needed.</p>
        <SegmentedControl
          label="Web access"
          value={backendSettings.knowledgeMode}
          options={[
            ["LOCAL_ONLY", "Local only"],
            ["ASK_BEFORE_WEB", "Ask me"],
            ["LOCAL_AUTO_WEB", "Automatic"],
          ]}
          onChange={(knowledgeMode) => updateBackendSettings({ knowledgeMode: knowledgeMode as KnowledgeMode })}
        />
        <p className="setting-note">
          {backendSettings.knowledgeMode === "LOCAL_ONLY"
            ? "Local only keeps search terms and page addresses on this computer."
            : backendSettings.knowledgeMode === "LOCAL_AUTO_WEB"
              ? "Automatic may send model-written search terms and HTTPS page addresses to the public web without asking again."
              : "Ask me is the safe default. Blendy explains why it wants the web before sending a search term or page address."}
        </p>
      </SettingsGroup>

      <SettingsGroup title="Instructions">
        <label className="text-setting instruction-setting">
          <span>About you</span>
          <textarea
            value={backendSettings.userInstructions || ""}
            maxLength={6000}
            placeholder="Example: I am a complete Blender beginner. I have made simple beveled product shapes before. Explain one step at a time and assume I may not know where tools live."
            onChange={(event) => updateBackendSettings({ userInstructions: event.target.value })}
          />
        </label>
        <p className="setting-note">Saved here is included with every prompt as background about your skill level, past projects, and preferred teaching style.</p>
      </SettingsGroup>

      <SettingsGroup title="LM Studio">
        <div className={`model-summary ${modelStatus?.reachable ? "ready" : "offline"}`}>
          <div>
            <strong>{modelStatus?.displayName || modelStatus?.modelId || "Automatic local model"}</strong>
            <span>{!modelStatus ? "Checking LM Studio" : modelStatus.reachable ? modelStatus.loaded === false ? "Found, but not loaded" : "Ready in LM Studio" : "LM Studio is not running"}</span>
          </div>
          <div className="model-capabilities">
            <span>{modelStatus?.vision === true ? "Vision ready" : modelStatus?.vision === false ? "No vision" : "Vision unknown"}</span>
            <span>{modelStatus?.toolUse === true ? "Tools ready" : modelStatus?.toolUse === false ? "No tools" : "Tools unknown"}</span>
            {modelStatus?.contextLength ? <span>{formatTokens(modelStatus.contextLength)} context</span> : null}
          </div>
        </div>
        <p className="setting-note">
          Automatic selects the loaded chat model and uses its real context size. You normally do not need to edit the controls below.
        </p>
        <details className="advanced-settings">
          <summary>Advanced model controls</summary>
          <div className="advanced-settings-body">
            <DataLine label="Provider" value="LM Studio" />
            <label className="text-setting">
              <span>Base URL</span>
              <input
                value={backendSettings.lmStudioBaseUrl}
                onChange={(event) => updateBackendSettings({ lmStudioBaseUrl: event.target.value })}
              />
            </label>
            <p className="setting-note">For privacy, Blendy accepts only localhost or 127.0.0.1 LM Studio addresses.</p>
            <label className="text-setting">
              <span>Model override</span>
              <input
                placeholder="auto"
                value={backendSettings.model}
                onChange={(event) => updateBackendSettings({ model: event.target.value || "auto" })}
              />
            </label>
            <label className="text-setting">
              <span>Response max</span>
              <input
                type="number"
                min="256"
                max="6000"
                step="256"
                value={backendSettings.responseMaxTokens}
                onChange={(event) => updateBackendSettings({ responseMaxTokens: Number(event.target.value) })}
              />
            </label>
            <label className="range-setting">
              <span>Context limit</span>
              <strong>{formatTokens(clampContextLimit(backendSettings.contextLimitTokens))}</strong>
              <input
                type="range"
                min={CONTEXT_LIMIT_MIN_TOKENS}
                max={CONTEXT_LIMIT_MAX_TOKENS}
                step={CONTEXT_LIMIT_STEP_TOKENS}
                value={clampContextLimit(backendSettings.contextLimitTokens)}
                onChange={(event) => updateBackendSettings({ contextLimitTokens: Number(event.target.value) })}
              />
            </label>
          </div>
        </details>
      </SettingsGroup>

      <SettingsGroup title="Diagnostics">
        <DataLine label="Blender bridge" value={contextSnapshot.bridgeStatus || "Unknown"} />
        <DataLine label="Blender version" value={contextSnapshot.blenderVersion || "Unknown"} />
        <DataLine
          label="Context usage"
          value={`${formatTokens(contextSnapshot.contextTokens || 0)} / ${formatTokens(contextSnapshot.contextLimitTokens || 70000)}`}
        />
        <DataLine label="Baseline context" value={formatTokens(contextSnapshot.baselineTokens || 0)} />
        <DataLine label="Conversation context" value={formatTokens(contextSnapshot.conversationTokens || 0)} />
        <DataLine label="Tool definitions" value={formatTokens(contextSnapshot.toolDefinitionTokens || 0)} />
        <DataLine label="Tool reserve" value={formatTokens(contextSnapshot.toolReserveTokens || 0)} />
        <DataLine label="Screenshot reserve" value={formatTokens(contextSnapshot.imageReserveTokens || 0)} />
        <DataLine label="Available for conversation" value={formatTokens(contextSnapshot.availableForConversationTokens || 0)} />
        <DataLine label="Bridge URL" value={contextSnapshot.bridgeUrl || backendSettings.bridgeUrl} />
        <DataLine label="Bridge mode" value={contextSnapshot.bridgeSource || backendSettings.bridgeUrl} />
        <DataLine label="Tool use" value={backendSettings.toolUse} />
        <DataLine label="Knowledge mode" value={contextSnapshot.knowledgeModeLabel || backendSettings.knowledgeMode} />
        <DataLine label="Docs index" value={contextSnapshot.docsIndexStatus || "Not checked yet"} />
        <DataLine label="Last web lookup" value={contextSnapshot.lastWebLookupStatus || "Not checked yet"} />
        <DataLine label="Knowledge reliance" value={contextSnapshot.knowledgeReliedOn || "Not checked yet"} />
        <DataLine
          label="Router"
          value={
            contextSnapshot.selectedRoute
              ? `${contextSnapshot.selectedRoute} · ${contextSnapshot.routeScore || 0}/100 · ${contextSnapshot.answerRisk || "risk unknown"}`
              : "Not checked yet"
          }
        />
        <DataLine label="Veteran cards" value={contextSnapshot.veteranCardsStatus || "Not loaded yet"} />
        <DataLine label="Selected cards" value={(contextSnapshot.selectedCards || []).join(" | ") || "None yet"} />
        <DataLine label="Source URLs" value={(contextSnapshot.knowledgeSourceUrls || []).join(" | ") || "None yet"} />
        <DataLine label="Current .blend" value={contextSnapshot.project} />
        <DataLine label="App data" value={contextSnapshot.appDataPath} />
        <DataLine label="Discovery file" value={contextSnapshot.bridgeDiscoveryPath || "Auto"} />
        <DataLine label="Chat file" value={chatPath || "Not created yet"} />
        <DataLine label="Prompt packet" value={contextSnapshot.promptPacketPath || "Not created yet"} />
        <p className="setting-note">Diagnostics opens the latest model request Blendy sent for this project, with Blender screen screenshot data omitted, so you can inspect grounding, tool calls, and context accounting.</p>
        <button
          className="secondary-button"
          type="button"
          onClick={onOpenPromptPacket}
          disabled={!contextSnapshot.promptPacketPath}
        >
          Diagnostics
        </button>
      </SettingsGroup>
    </main>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented-row">
      <span>{label}</span>
      <div className="segmented-control" role="radiogroup" aria-label={label}>
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            className={value === optionValue ? "active" : ""}
            type="button"
            role="radio"
            aria-checked={value === optionValue}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

export default App;
