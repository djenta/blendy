import {
  Check,
  ChevronLeft,
  Eye,
  FileText,
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
  Trash2,
  X,
} from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import logoUrl from "./assets/blendy-header-mark.png";
import { contextSnapshot as mockContextSnapshot, seedMessages } from "./data";
import type {
  AppSettings,
  AssistantReceipt,
  BackendSettings,
  ChatEvent,
  ChatSession,
  ContextSnapshot,
  KnowledgeMode,
  Message,
  PageName,
  ThemeName,
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
  responseMaxTokens: 8000,
  contextLimitTokens: 70000,
  knowledgeMode: "LOCAL_AUTO_WEB",
};

const CONTEXT_LIMIT_MIN_TOKENS = 10000;
const CONTEXT_LIMIT_MAX_TOKENS = 256000;
const CONTEXT_LIMIT_STEP_TOKENS = 1000;

const themeLabels: Record<ThemeName, string> = {
  solar: "Scholastic Solar",
  sprint: "Neon Sprint",
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
  return `Context ${formatTokens(used)} / ${formatTokens(limit)}. Conversation ${formatTokens(conversation)}.`;
}

function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [page, setPage] = useState<PageName>("chat");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [messages, setMessages] = useState<Message[]>(window.blendyApp ? [] : seedMessages);
  const [contextSnapshot, setContextSnapshot] = useState<ContextSnapshot>(mockContextSnapshot);
  const [backendSettings, setBackendSettings] = useState<BackendSettings>(defaultBackendSettings);
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
  const generatedSnapTokenRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const messageSignatureRef = useRef("");
  const savedChatScrollTopRef = useRef(0);
  const restoreChatScrollRef = useRef(false);

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
          activeMessage.status === "done" || activeMessage.status === "failed",
        );
        if (activeMessage.status === "done" || activeMessage.status === "failed") {
          activeGeneratedMessageIdRef.current = null;
        }
        return;
      }
    }

    const node = scrollRef.current;
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
    setBackendSettings((current) => {
      const next = { ...current, ...partial };
      window.blendyApp?.saveBackendSettings(next).catch(() => undefined);
      return next;
    });
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
      setMessages((current) =>
        current.map((message) =>
          message.id === event.id
            ? {
                ...message,
                content: event.content,
                status: "done",
              }
            : message,
        ),
      );
      setIsGenerating(false);
      setLatestDone(true);
      window.setTimeout(() => setLatestDone(false), 1500);
      refreshBackendState();
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
    setIsGenerating(false);
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
        applyDiagnostics(state.diagnostics);
      })
      .catch(() => undefined);
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

  async function sendPrompt() {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isGenerating) {
      return;
    }

    setPrompt("");
    setIsGenerating(true);
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
      return;
    }

    try {
      const result = await window.blendyApp.sendMessage({
        prompt: cleanPrompt,
        backendSettings,
        chatId: activeChatId,
      });
      setContextSnapshot(result.context);
      applyDiagnostics(result.diagnostics);
      beginGeneratedReplySnap(result.assistantMessage.id);
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
    setLatestDone(false);
    try {
      const result = await window.blendyApp.regenerateLast({
        backendSettings,
        chatId: activeChatId,
      });
      setContextSnapshot(result.context);
      applyDiagnostics(result.diagnostics);
      beginGeneratedReplySnap(result.assistantMessage.id);
      setMessages((current) => [...current, result.assistantMessage]);
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
    }
  }

  async function compactNow() {
    if (!window.blendyApp || isGenerating || isManagingContext) {
      return;
    }
    setContextMenuOpen(false);
    setIsManagingContext(true);
    try {
      const result = await window.blendyApp.compactChat({ backendSettings });
      setMessages(result.messages);
      setContextSnapshot(result.context);
      applyDiagnostics(result.diagnostics);
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
    } finally {
      setIsManagingContext(false);
    }
  }

  async function freshChat() {
    if (!window.blendyApp || isGenerating || isManagingContext) {
      return;
    }
    setChatMenuOpen(false);
    setContextMenuOpen(false);
    setEditingChatId("");
    setConfirmingDeleteChatId("");
    setIsManagingContext(true);
    try {
      const result = await window.blendyApp.freshChat({ backendSettings });
      setMessages(result.messages);
      setContextSnapshot(result.context);
      applyDiagnostics(result.diagnostics);
      setContextMenuOpen(false);
      setEditingChatId("");
      setPrompt("");
      requestComposerFocus();
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
    } finally {
      setIsManagingContext(false);
    }
  }

  async function switchChat(chatId: string) {
    if (!window.blendyApp || isGenerating || isManagingContext || chatId === activeChatId) {
      setChatMenuOpen(false);
      return;
    }
    setChatMenuOpen(false);
    setContextMenuOpen(false);
    setEditingChatId("");
    setConfirmingDeleteChatId("");
    setIsManagingContext(true);
    try {
      const result = await window.blendyApp.switchChat({ chatId, backendSettings });
      setMessages(result.messages);
      setContextSnapshot(result.context);
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
    } catch (_error) {
      setEditingChatId("");
    }
  }

  async function deleteChat(chatId: string) {
    if (!window.blendyApp || isGenerating || isManagingContext) {
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
      const result = await window.blendyApp.deleteChat({ chatId, backendSettings });
      setMessages(result.messages);
      setContextSnapshot(result.context);
      applyDiagnostics(result.diagnostics);
      setPrompt("");
      requestComposerFocus();
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
    } finally {
      setIsManagingContext(false);
    }
  }

  async function captureViewport() {
    if (!window.blendyApp) {
      return;
    }
    const context = await window.blendyApp.refreshContext({ forceScreenshot: true, chatId: activeChatId });
    setContextSnapshot(context);
  }

  async function openProjectBrief() {
    if (!window.blendyApp || !contextSnapshot.projectBriefPath) {
      return;
    }
    await window.blendyApp.openProjectBrief(contextSnapshot.projectBriefPath);
  }

  async function openPromptPacket() {
    if (!window.blendyApp || !contextSnapshot.promptPacketPath) {
      return;
    }
    await window.blendyApp.openDiagnosticFile(contextSnapshot.promptPacketPath);
  }

  return (
    <div className="app-window">
      <header className="titlebar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="" />
          <div>
            <div className="brand-name">Blendy 1.0.5</div>
            <div className="brand-subtitle">
              {page === "settings" ? "Settings" : latestDone ? "Done" : isGenerating ? "Reading Blender..." : "Local Blender Tutor"}
            </div>
          </div>
        </div>

        <div className="window-actions">
          <button className="icon-button" type="button" onClick={togglePinned} title={pinned ? "Unpin window" : "Pin window"}>
            {pinned ? <Pin size={16} /> : <PinOff size={16} />}
          </button>
          {page === "chat" && (
            <button className="icon-button" type="button" onClick={() => setDrawerOpen((open) => !open)} title="Context">
              <PanelRight size={17} />
            </button>
          )}
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
          chatPath={chatPath}
          onOpenPromptPacket={openPromptPacket}
        />
      ) : (
        <main className={`chat-layout ${drawerOpen ? "drawer-open" : ""}`}>
          <section className="chat-page">
            <div className="messages" ref={scrollRef} onScroll={handleScroll}>
              {messages.map((message, index) => (
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
              ))}
            </div>
            {showJumpLatest && (
              <button className="jump-latest" type="button" onClick={jumpToLatest}>
                New text
              </button>
            )}
            <div className="floating-controls" ref={contextControlRef}>
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
                        <span>Baseline scene/prompt</span>
                        <strong>{formatTokens(contextSnapshot.baselineTokens || 0)}</strong>
                      </div>
                      <div>
                        <span>Conversation</span>
                        <strong>{formatTokens(contextSnapshot.conversationTokens || 0)}</strong>
                      </div>
                    </div>
                    <p className="context-menu-note">Compact shrinks conversation history, not the baseline Blender context Blendy needs to answer accurately.</p>
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

            <footer className="composer">
              <textarea
                ref={promptInputRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handlePromptKeyDown}
                placeholder="Ask Blendy what to do next..."
                rows={2}
              />
              <button className="send-button" type="button" onClick={sendPrompt} disabled={!prompt.trim() || isGenerating}>
                <Send size={17} />
              </button>
            </footer>
          </section>

          {drawerOpen && (
            <ContextDrawer
              contextSnapshot={contextSnapshot}
              onCaptureViewport={captureViewport}
              onOpenProjectBrief={openProjectBrief}
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

  return (
    <article ref={(node) => registerMessageNode(message.id, node)} className={`message-row ${message.role}`}>
      <div className="message-label">{message.role === "user" ? "You" : "Blendy"}</div>
      <div className="message-content">
        {message.content ? (
          message.content.split("\n").map((line) => <p key={line}>{line}</p>)
        ) : (
          <div className="typing-line">
            <Sparkles size={15} />
            Thinking...
          </div>
        )}
      </div>
      {message.context && (
        <button
          className={`used-context ${message.role === "assistant" ? "assistant-receipt" : ""}`}
          type="button"
          onClick={() => message.role === "assistant" && message.receipt ? onReceiptClick(message) : undefined}
        >
          {message.context}
        </button>
      )}
      {message.status === "failed" && (
        <button className="inline-action" type="button" onClick={onRegenerate}>
          <RefreshCcw size={14} />
          Retry
        </button>
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
  const usedQueries = receipt.web?.usedQueries || [];
  const attemptedQueries = receipt.web?.queries || [];
  const webQuery = usedQueries[0] || attemptedQueries[0] || "";
  return (
    <div className="receipt-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="receipt-panel" role="dialog" aria-modal="true" aria-label="Blendy receipt" onMouseDown={(event) => event.stopPropagation()}>
        <div className="receipt-head">
          <div>
            <h2>Receipt</h2>
            <p>{message.context || "What Blendy used"}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close receipt">
            <X size={15} />
          </button>
        </div>

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

        {!cards.length && !receipt.web?.status && !webQuery && (
          <p className="receipt-empty">No detailed receipt data was stored for this message.</p>
        )}
      </section>
    </div>
  );
}

function ContextDrawer({
  contextSnapshot,
  onCaptureViewport,
  onOpenProjectBrief,
  onClose,
}: {
  contextSnapshot: ContextSnapshot;
  onCaptureViewport: () => void;
  onOpenProjectBrief: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="context-drawer">
      <div className="drawer-header">
        <div>
          <h2>Blender Context</h2>
          <p>Latest captured project state</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose} title="Close context">
          <X size={15} />
        </button>
      </div>

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

      <ContextSection icon={<FileText size={16} />} title="Project Brief">
        <p className="drawer-copy">{contextSnapshot.brief}</p>
        <button className="secondary-button" type="button" onClick={onOpenProjectBrief}>Open brief</button>
      </ContextSection>
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
  chatPath,
  onOpenPromptPacket,
}: {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  backendSettings: BackendSettings;
  updateBackendSettings: (partial: Partial<BackendSettings>) => void;
  contextSnapshot: ContextSnapshot;
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

      <SettingsGroup title="Knowledge">
        <SegmentedControl
          label="Knowledge"
          value={backendSettings.knowledgeMode}
          options={[
            ["LOCAL_AUTO_WEB", "Local + Auto Web"],
            ["LOCAL_ONLY", "Local Only"],
            ["ASK_BEFORE_WEB", "Ask Before Web"],
          ]}
          onChange={(knowledgeMode) => updateBackendSettings({ knowledgeMode: knowledgeMode as KnowledgeMode })}
        />
        <p className="setting-note">Auto Web checks allowlisted Blender sources and shows what it used in Diagnostics.</p>
      </SettingsGroup>

      <SettingsGroup title="LM Studio">
        <DataLine label="Provider" value="LM Studio" />
        <label className="text-setting">
          <span>Base URL</span>
          <input
            value={backendSettings.lmStudioBaseUrl}
            onChange={(event) => updateBackendSettings({ lmStudioBaseUrl: event.target.value })}
          />
        </label>
        <label className="text-setting">
          <span>Model</span>
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
            max="32000"
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
        <DataLine label="Bridge URL" value={contextSnapshot.bridgeUrl || backendSettings.bridgeUrl} />
        <DataLine label="Bridge mode" value={contextSnapshot.bridgeSource || backendSettings.bridgeUrl} />
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
        <DataLine label="Project Brief" value={contextSnapshot.projectBriefPath} />
        <DataLine label="App data" value={contextSnapshot.appDataPath} />
        <DataLine label="Discovery file" value={contextSnapshot.bridgeDiscoveryPath || "Auto"} />
        <DataLine label="Chat file" value={chatPath || "Not created yet"} />
        <DataLine label="Prompt packet" value={contextSnapshot.promptPacketPath || "Not created yet"} />
        <p className="setting-note">Diagnostics opens the latest model request Blendy sent for this project, with Blender screen screenshot data omitted, so you can inspect grounding, router choices, and selected cards.</p>
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
      <div className="segmented-control">
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            className={value === optionValue ? "active" : ""}
            type="button"
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
