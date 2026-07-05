const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8765";
const DEFAULT_LM_STUDIO_BASE_URL = "http://localhost:1234/v1";
const DEFAULT_RESPONSE_MAX_TOKENS = 8000;
const DEFAULT_CONTEXT_LIMIT_TOKENS = 70000;
const DEFAULT_AUTO_COMPACT_RATIO = 0.95;
const AUTO_BRIDGE_URL = "auto";
const KNOWLEDGE_MODE_LOCAL_AUTO_WEB = "LOCAL_AUTO_WEB";
const KNOWLEDGE_MODE_LOCAL_ONLY = "LOCAL_ONLY";
const KNOWLEDGE_MODE_ASK_BEFORE_WEB = "ASK_BEFORE_WEB";
const KNOWLEDGE_MODE_LABELS = {
  [KNOWLEDGE_MODE_LOCAL_AUTO_WEB]: "Local + Auto Web",
  [KNOWLEDGE_MODE_LOCAL_ONLY]: "Local Only",
  [KNOWLEDGE_MODE_ASK_BEFORE_WEB]: "Ask Before Web",
};
const PROJECT_BRIEF_PROMPT_KEYWORDS = [
  "project brief",
  "truth.md",
  "truth md",
  "project goal",
  "overall goal",
  "requirements",
  "constraints",
  "what am i making",
  "what are we making",
  "remember",
  "supposed to be",
];
const BLENDER_VERSION_RE = /\bBlender version:\s*([^\n\r]+)/i;
const USER_STATED_BLENDER_VERSION_RE = /\bblender\s+([0-9]+(?:\.[0-9]+){0,2}(?:[-_a-zA-Z0-9.]*)?)/i;

const VISUAL_PROMPT_KEYWORDS = [
  "see",
  "screenshot",
  "look",
  "looks",
  "visible",
  "shape",
  "silhouette",
  "proportion",
  "proportions",
  "view",
  "frame",
  "camera",
  "render",
  "object",
  "model",
  "mesh",
  "phone",
  "iphone",
  "rectangle",
  "cube",
  "what do i do first",
  "what do i do next",
  "what's next",
  "does this",
  "is this",
];

const SYSTEM_PROMPT = `You are Blendy, a vibe-coded local Blender tutor Frank made because he keeps bouncing off Blender and wants guidance and persistence. You live inside the user's local Blender workflow.

Primary user workflow:
- The user is a complete Blender beginner with strong product/design thinking.
- Your job is to prevent overwhelm by turning the current scene into the next small, doable Blender action.
- Keep Frank moving through one clear checkpoint at a time.

Truth ladder:
- The user's latest prompt is the task. Project Brief and scene context are background unless they directly answer that task.
- Trust live Blender runtime facts and screenshot evidence first.
- The live Blender version is a hard constraint. If runtime says Blender 5.0 or another exact version, give directions for that version and do not fall back to older-version UI memory.
- If Blender version facts conflict with model memory, follow the provided runtime version. If you are not sure a UI path still exists in that version, say so and give a version-safe way to find it.
- If no live version is available but the user states a Blender version in the latest prompt, follow the user's stated version for that answer.
- Then trust current scene context, selected object data, and scene changes since the last prompt.
- Preserve object roles the user establishes in recent chat. If the user says an object is a connector, cutout, port, screen, body, button, cable part, or other part, keep that role unless live scene evidence clearly contradicts it.
- For multi-part objects, reason about the physical assembly before giving tool steps. Do not skip a part the user already made; explain which existing part should be reused, refined, duplicated, converted, or left alone.
- For part-relationship questions framed as "should this attach/connect/plug/touch/go into A or B", answer the immediate contact relationship first. Preserve the named roles in the user's wording, build the shortest physical chain between the parts, and do not collapse an intermediate part into a larger body just because they are near each other.
- Project Brief / truth.md is optional memory. It is normally omitted; use it only when it is included or when the user asks about the project goal, requirements, constraints, or truth.md.
- Then trust KNOWLEDGE REFERENCES and WEB REFERENCES. Local official docs are the authority for stable Blender facts; broad web results are allowed for current info, community workflow discoveries, add-ons, names, and examples, but label them by source quality.
- Use WORKFLOW CARDS as veteran Blender workflow wisdom: if a card says the user is brute-forcing a task, suggest the smarter Blender-native move instead of more manual edits.
- Use TROUBLESHOOTING CARDS when the user followed a step but the result is missing, wrong, unchanged, or confusing. Diagnose likely blockers before giving more modeling steps.
- Then trust BLENDER TOOL REFERENCES as local beginner-pitfall notes.
- Use model memory only as background, never as stronger evidence than provided Blender facts.
- If the evidence is incomplete, say it naturally: "I can see...", "I'm inferring...", or "I can't tell from the current Blendy context."
- Do not invent Blender state, UI locations, file contents, object names, measurements, or actions you cannot verify from the provided context.
- If the user asks about Blender startup defaults, preferences, future new files, or general app behavior, answer that global Blender question instead of forcing the answer back to the current project units or scene.
- If the latest prompt is clearly not a Blender question, do not force the answer through Blender docs or the current scene. If WEB REFERENCES contains sources, answer the non-Blender question from those sources instead of saying you are only a Blender tutor. If no source is available, say the lookup did not return a usable source.
- If local and web references still do not support a confident answer, ask one clarifying question instead of inventing Blender steps.

Answer contract:
- Give the direct answer first, then one small next step, then one simple check for whether it worked.
- Teach with Blender UI steps first. Use plain English and explain Blender terms.
- Name the Blender mode, tool/menu/operator, and exact action sequence when known.
- Prefer one useful next operation or a short sequence over a long list of possibilities.
- Before adding a new object, consider whether the selected/existing object should be reused, refined, duplicated, or converted because the user may have made it for this purpose.
- For flexible physical parts like cables, hoses, straps, cords, and wires, prefer Curve objects with bevel depth when that is simpler and more realistic than a straight mesh cylinder.
- Answer in a natural tutor voice, like a normal LLM chat response.
- Do not expose a worksheet, rubric, checklist, scratchpad, or internal analysis.
- Internally consider the goal, next tool, exact steps, check, and fallback, but do not use those as visible section labels.
- Do not label sections "Goal", "Next tool", "Exact steps", "Check", or "If it looks wrong".
- If the user asks whether something looks right, use the screenshot and scene context first.
- Use Blender runtime facts, screenshot, scene context, selected object data, and included Project Brief as evidence.
- Use KNOWLEDGE REFERENCES, WEB REFERENCES, and BLENDER TOOL REFERENCES as evidence notes. Do not dump them back; turn them into beginner steps and naturally mention when you checked the Blender manual or web.
- Never claim you searched Google, checked the live web, found search results, or used online sources unless WEB REFERENCES contains actual retrieved source URLs. If WEB REFERENCES says Ask Before Web skipped or web lookup was not run, say you have not searched yet.
- Do not say you lack a web search tool just because WEB REFERENCES is empty. If the user asked to search and WEB REFERENCES says lookup attempted/approved but no usable snippet was retrieved, say the web lookup did not return a usable source and ask whether to keep working from Blender context or try a more specific search phrase.
- Do not claim you changed the scene. You cannot execute Blender actions.
- Never imply you clicked, created, deleted, applied, fixed, or rendered anything yourself.
- Do not provide Blender Python unless the user explicitly asks for code.
- Keep answers concise, practical, and oriented around what the user should click, inspect, or try next.
- Ask at most one clarifying question, and only after giving the best likely next step.`;

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizeBaseUrl(value, fallback) {
  return (value || fallback).trim().replace(/\/+$/, "");
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(timer) };
}

async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: timeout.controller.signal,
    });
    const text = await response.text();
    let data = {};
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = { text };
      }
    }
    if (!response.ok) {
      const detail = data.error || data.message || data.text || response.statusText;
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    return data;
  } finally {
    timeout.done();
  }
}

function defaultSettings() {
  return {
    bridgeUrl: AUTO_BRIDGE_URL,
    lmStudioBaseUrl: DEFAULT_LM_STUDIO_BASE_URL,
    model: "auto",
    responseMaxTokens: DEFAULT_RESPONSE_MAX_TOKENS,
    contextLimitTokens: DEFAULT_CONTEXT_LIMIT_TOKENS,
    knowledgeMode: KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
  };
}

function normalizeKnowledgeMode(value) {
  const cleaned = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned === "LOCAL_ONLY") {
    return KNOWLEDGE_MODE_LOCAL_ONLY;
  }
  if (cleaned === "ASK" || cleaned === "ASK_BEFORE_WEB") {
    return KNOWLEDGE_MODE_ASK_BEFORE_WEB;
  }
  return KNOWLEDGE_MODE_LOCAL_AUTO_WEB;
}

function knowledgeModeLabel(value) {
  return KNOWLEDGE_MODE_LABELS[normalizeKnowledgeMode(value)] || KNOWLEDGE_MODE_LABELS[KNOWLEDGE_MODE_LOCAL_AUTO_WEB];
}

function defaultBridgeContext(settings, errorMessage = "") {
  return {
    ok: false,
    bridgeUrl: settings.bridgeUrl,
    error: errorMessage,
    project: {
      name: "No Blender project connected",
      path: "",
      truthPath: "",
      appDataPath: "",
    },
    contextLine: "Used: Blender bridge unavailable",
    selected: {
      object: "Unavailable",
      mode: "Unknown",
      units: "Unknown",
      dimensions: "Unknown",
      scale: "Unknown",
    },
    modifiers: [],
    scene: {
      name: "Unknown",
      summary: "Start Blender and launch the Blendy bridge from the N panel.",
      materials: [],
    },
    visual: "Viewport not inspected",
    brief: "",
    used: {
      screenshot: false,
      screenshotReason: "bridge unavailable",
    },
    promptParts: {
      system_prompt: "",
      context_text: "",
      knowledge_prompt: "",
      web_approved: false,
      truth_md: "",
      scene_context: "",
      scene_diff: "",
      runtime_facts: "",
      tool_references: "",
      router_decision: "",
      scene_diagnostic_flags: "",
      workflow_cards: "",
      troubleshooting_cards: "",
      router_trace: {},
      knowledge_references: "",
      web_references: "",
      semantic_scene_card: "",
      verification_notes: "",
      knowledge_status: {
        mode: normalizeKnowledgeMode(settings.knowledgeMode),
        modeLabel: knowledgeModeLabel(settings.knowledgeMode),
        docsIndexStatus: "No Blender bridge connected; docs index status unavailable.",
        lastWebLookupStatus: "No web lookup run without Blender context.",
        sourceUrls: [],
        confidence: 0,
        reliedOn: "model memory fallback only",
      },
      knowledge_sources: [],
      compacted_summary: "",
    },
  };
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function contextPercent(tokens, limit) {
  if (!limit || limit <= 0) {
    return 0;
  }
  return Math.min(999, Math.round((tokens / limit) * 100));
}

function contextStatus(tokens, limit) {
  const percent = contextPercent(tokens, limit);
  if (percent >= 90) {
    return "DANGER";
  }
  if (percent >= 80) {
    return "WARN";
  }
  return "OK";
}

function autoCompactThreshold(settings) {
  const limit = Math.max(1000, Number(settings.contextLimitTokens || DEFAULT_CONTEXT_LIMIT_TOKENS));
  return Math.floor(limit * DEFAULT_AUTO_COMPACT_RATIO);
}

function estimateContextUsage({ prompt = "", context, chat, settings }) {
  const limit = Math.max(1000, Number(settings.contextLimitTokens || DEFAULT_CONTEXT_LIMIT_TOKENS));
  const contextText = buildContextText(prompt, context, chat.compactedSummary || "");
  const systemPrompt = context.promptParts?.system_prompt || SYSTEM_PROMPT;
  const historyText = trimHistory(chat.messages)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");
  const baselineTokens = estimateTokens(`${systemPrompt}\n\n${contextText}`);
  const historyTokens = estimateTokens(historyText);
  const promptTokens = estimateTokens(prompt);
  const tokens = baselineTokens + historyTokens;
  return {
    tokens,
    limit,
    percent: contextPercent(tokens, limit),
    status: contextStatus(tokens, limit),
    baselineTokens,
    historyTokens,
    promptTokens,
  };
}

function contextToSnapshot(context, userDataPath, usage = null, promptPacketFilePath = "") {
  const runtimeVersion = blenderVersionFromRuntime(context.promptParts?.runtime_facts || "");
  const knowledgeStatus = context.promptParts?.knowledge_status || {};
  const knowledgeSources = Array.isArray(context.promptParts?.knowledge_sources)
    ? context.promptParts.knowledge_sources
    : [];
  const routerTrace = context.promptParts?.router_trace || {};
  return {
    project: context.project?.name || "No Blender project connected",
    projectBriefPath: context.project?.truthPath || "",
    appDataPath: context.project?.appDataPath || userDataPath,
    units: context.selected?.units || "Unknown",
    selectedObject: context.selected?.object || "Unavailable",
    mode: context.selected?.mode || "Unknown",
    dimensions: context.selected?.dimensions || "Unknown",
    scale: context.selected?.scale || "Unknown",
    modifiers: (context.modifiers || []).map((modifier) => ({
      name: modifier.name || "Modifier",
      detail: modifier.detail || "",
    })),
    materials: context.scene?.materials || [],
    scene: context.scene?.summary || context.scene?.name || "Unknown",
    visual: context.visual || "Viewport not inspected",
    brief: context.brief || "",
    bridgeOk: Boolean(context.ok),
    bridgeStatus: context.ok ? "Connected" : context.error || "Disconnected",
    bridgeUrl: context.bridgeUrl || "",
    bridgeSource: context.bridgeSource || "",
    bridgeDiscoveryPath: context.bridgeDiscoveryPath || "",
    blenderVersion: context.bridge?.blenderVersion || runtimeVersion || "",
    contextTokens: usage?.tokens || 0,
    baselineTokens: usage?.baselineTokens || 0,
    conversationTokens: usage?.historyTokens || 0,
    latestPromptTokens: usage?.promptTokens || 0,
    contextLimitTokens: usage?.limit || DEFAULT_CONTEXT_LIMIT_TOKENS,
    contextPercent: usage?.percent || 0,
    contextStatus: usage?.status || "OK",
    contextLine: context.contextLine || "Used: Blender context unavailable",
    usedScreenshot: Boolean(context.used?.screenshot),
    promptPacketPath: promptPacketFilePath,
    knowledgeMode: knowledgeStatus.mode || context.used?.knowledgeMode || "",
    knowledgeModeLabel: knowledgeStatus.modeLabel || knowledgeModeLabel(knowledgeStatus.mode || context.used?.knowledgeMode),
    docsIndexStatus: knowledgeStatus.docsIndexStatus || "",
    lastWebLookupStatus: knowledgeStatus.lastWebLookupStatus || "",
    knowledgeConfidence: Number(knowledgeStatus.confidence || 0),
    knowledgeReliedOn: knowledgeStatus.reliedOn || "",
    knowledgeSourceUrls: Array.isArray(knowledgeStatus.sourceUrls) ? knowledgeStatus.sourceUrls : [],
    selectedRoute: knowledgeStatus.selectedRoute || routerTrace.selectedRoute || "",
    routeScore: Number(knowledgeStatus.routeScore || routerTrace.score || 0),
    answerRisk: knowledgeStatus.answerRisk || routerTrace.answerRisk || "",
    veteranCardsStatus: knowledgeStatus.veteranCardsStatus || routerTrace.cardsStatus || "",
    selectedCards: Array.isArray(knowledgeStatus.selectedCards) ? knowledgeStatus.selectedCards : [],
    knowledgeSources: knowledgeSources.map((source) => ({
      title: source.title || "Source",
      url: source.url || "",
      authority: source.authority || "",
      confidence: Number(source.confidence || 0),
      score: Number(source.score || 0),
      sourceQuality: source.sourceQuality || "",
    })),
  };
}

function assistantContextLine(context) {
  return assistantReceipt(context).line;
}

function assistantReceipt(context) {
  const parts = context.promptParts || {};
  const knowledgeStatus = parts.knowledge_status || {};
  const routerTrace = parts.router_trace || {};
  const tags = [];
  const route = String(knowledgeStatus.selectedRoute || routerTrace.selectedRoute || "").trim();
  const webStatus = String(knowledgeStatus.lastWebLookupStatus || routerTrace.webDecision || "").toLowerCase();
  const workflowCards = Array.isArray(routerTrace.workflowCards) ? routerTrace.workflowCards : [];
  const troubleshootingCards = Array.isArray(routerTrace.troubleshootingCards) ? routerTrace.troubleshootingCards : [];
  const knowledgeSources = Array.isArray(parts.knowledge_sources) ? parts.knowledge_sources : [];
  const sourceUrls = Array.isArray(knowledgeStatus.sourceUrls) ? knowledgeStatus.sourceUrls : [];
  const webSearchQueries = Array.isArray(knowledgeStatus.webSearchQueries)
    ? knowledgeStatus.webSearchQueries
    : Array.isArray(routerTrace.webSearchQueries)
      ? routerTrace.webSearchQueries
      : [];
  const webSearchUsedQueries = Array.isArray(knowledgeStatus.webSearchUsedQueries)
    ? knowledgeStatus.webSearchUsedQueries
    : Array.isArray(routerTrace.webSearchUsedQueries)
      ? routerTrace.webSearchUsedQueries
      : [];

  if (webStatus.includes("used")) {
    tags.push("Web Search");
  } else if (webStatus.includes("attempted")) {
    tags.push("Web Search");
  } else if (webStatus.includes("ask before web")) {
    tags.push("Web Permission Needed");
  }
  if (String(knowledgeStatus.reliedOn || "").toLowerCase().includes("official docs")) {
    tags.push("Blender Docs");
  }
  if (workflowCards.length) {
    tags.push("Workflow Shortcut");
  }
  if (troubleshootingCards.length || route === "troubleshooting") {
    tags.push("Troubleshooting");
  }

  const unique = [];
  for (const tag of tags) {
    if (tag && !unique.includes(tag)) {
      unique.push(tag);
    }
  }
  const cards = [...troubleshootingCards, ...workflowCards].map((card) => ({
    id: card.id || "",
    title: card.title || card.id || "Selected card",
    type: card.type || "",
    score: Number(card.score || 0),
    confidence: Number(card.confidence || 0),
    sourceQuality: card.sourceQuality || "",
    destructiveRisk: card.destructiveRisk || "",
    matchedChecks: Array.isArray(card.matchedChecks) ? card.matchedChecks : [],
    reasons: Array.isArray(card.reasons) ? card.reasons : [],
    betterMove: card.betterMove || "",
    diagnosisOrder: card.diagnosisOrder || "",
    sources: Array.isArray(card.sources) ? card.sources : [],
  }));
  const webSources = knowledgeSources
    .filter((source) => source && source.url)
    .map((source) => ({
      title: source.title || source.url || "Source",
      url: source.url || "",
      authority: source.authority || "",
      confidence: Number(source.confidence || 0),
      whyUsed: source.whyUsed || "",
      summary: source.summary || "",
      retrieved: source.retrieved || "",
      searchQuery: source.searchQuery || "",
    }));
  const details = {
    labels: unique,
    cards,
    web: {
      status: knowledgeStatus.lastWebLookupStatus || routerTrace.webDecision || "",
      queries: webSearchQueries,
      usedQueries: webSearchUsedQueries,
      urls: sourceUrls,
      sources: webSources,
      references: String(parts.web_references || "").slice(0, 3000),
    },
  };
  return {
    line: unique.length ? `Used: ${unique.slice(0, 4).join(" · ")}` : "",
    details,
  };
}

function projectKey(context) {
  const source = context.project?.path || "no-blender-project";
  return crypto.createHash("sha1").update(source).digest("hex").slice(0, 20);
}

function chatPath(userDataPath, key) {
  return path.join(userDataPath, "chats", `${key}.json`);
}

function chatIndexPath(userDataPath) {
  return path.join(userDataPath, "chats", "chat-sessions.json");
}

function chatStorageKey(sessionId) {
  return `chat-${sessionId}`;
}

function newSessionId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function cleanChatTitle(title) {
  return String(title || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function inferChatTitle(chat, fallback = "New chat") {
  const firstUser = (chat.messages || []).find((message) => message.role === "user" && String(message.content || "").trim());
  return cleanChatTitle(firstUser?.content || fallback) || fallback;
}

function sortChatSessions(sessions) {
  return [...(sessions || [])].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function normalizeChatIndex(raw) {
  const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
  const normalizedSessions = sessions
    .filter((session) => session && session.id)
    .map((session) => ({
      id: String(session.id),
      title: cleanChatTitle(session.title) || "Untitled chat",
      createdAt: session.createdAt || session.updatedAt || new Date().toISOString(),
      updatedAt: session.updatedAt || session.createdAt || new Date().toISOString(),
    }));
  return {
    version: 1,
    activeSessionId: raw.activeSessionId || normalizedSessions[0]?.id || "",
    sessions: sortChatSessions(normalizedSessions),
  };
}

function writeChatIndex(userDataPath, index) {
  const normalized = normalizeChatIndex(index);
  writeJson(chatIndexPath(userDataPath), normalized);
  return normalized;
}

function createSessionRecord(title = "New chat") {
  const now = new Date().toISOString();
  return {
    id: newSessionId(),
    title: cleanChatTitle(title) || "New chat",
    createdAt: now,
    updatedAt: now,
  };
}

function migrateLegacyChats(userDataPath) {
  const chatsDir = path.join(userDataPath, "chats");
  if (!fs.existsSync(chatsDir)) {
    return [];
  }
  return fs
    .readdirSync(chatsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .filter((entry) => entry.name !== "chat-sessions.json" && !entry.name.endsWith(".sessions.json"))
    .filter((entry) => !entry.name.startsWith("chat-"))
    .map((entry) => {
      const key = entry.name.replace(/\.json$/, "");
      const legacy = loadChat(userDataPath, key);
      const hasContent = legacy.messages.length > 0 || (legacy.compactedSummary || "").trim();
      if (!hasContent) {
        return null;
      }
      const filePath = path.join(chatsDir, entry.name);
      const stat = fs.statSync(filePath);
      const session = createSessionRecord(inferChatTitle(legacy, "Imported chat"));
      session.createdAt = stat.birthtime?.toISOString?.() || session.createdAt;
      session.updatedAt = stat.mtime?.toISOString?.() || session.updatedAt;
      saveChat(userDataPath, chatStorageKey(session.id), legacy);
      return session;
    })
    .filter(Boolean);
}

function ensureChatSessions(userDataPath) {
  const filePath = chatIndexPath(userDataPath);
  if (fs.existsSync(filePath)) {
    const existing = normalizeChatIndex(readJson(filePath, {}));
    if (existing.sessions.length) {
      return writeChatIndex(userDataPath, existing);
    }
  }

  const migrated = migrateLegacyChats(userDataPath);
  const sessions = migrated.length ? sortChatSessions(migrated) : [createSessionRecord("New chat")];
  const index = writeChatIndex(userDataPath, {
    activeSessionId: sessions[0].id,
    sessions,
  });
  if (!migrated.length) {
    saveChat(userDataPath, chatStorageKey(sessions[0].id), { messages: [], compactedSummary: "" });
  }
  return index;
}

function activeChatState(userDataPath, requestedSessionId = "") {
  const index = ensureChatSessions(userDataPath);
  const requested = requestedSessionId && index.sessions.find((session) => session.id === requestedSessionId);
  const activeSession = requested || index.sessions.find((session) => session.id === index.activeSessionId) || index.sessions[0];
  if (!activeSession) {
    const session = createSessionRecord();
    const nextIndex = writeChatIndex(userDataPath, {
      activeSessionId: session.id,
      sessions: [session],
    });
    return {
      index: nextIndex,
      session,
      storageKey: chatStorageKey(session.id),
      chat: loadChat(userDataPath, chatStorageKey(session.id)),
    };
  }
  if (index.activeSessionId !== activeSession.id) {
    writeChatIndex(userDataPath, { ...index, activeSessionId: activeSession.id });
  }
  const storageKey = chatStorageKey(activeSession.id);
  return {
    index: ensureChatSessions(userDataPath),
    session: activeSession,
    storageKey,
    chat: loadChat(userDataPath, storageKey),
  };
}

function publicChatSessions(index) {
  return sortChatSessions(index.sessions || []);
}

function touchChatSession(userDataPath, sessionId, chat, title = "") {
  const index = ensureChatSessions(userDataPath);
  const now = new Date().toISOString();
  const sessions = index.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session;
    }
    return {
      ...session,
      title: cleanChatTitle(title) || session.title || inferChatTitle(chat),
      updatedAt: now,
    };
  });
  return writeChatIndex(userDataPath, { ...index, activeSessionId: sessionId, sessions });
}

function createNewChatSession(userDataPath) {
  const index = ensureChatSessions(userDataPath);
  const session = createSessionRecord("New chat");
  const nextIndex = writeChatIndex(userDataPath, {
    activeSessionId: session.id,
    sessions: [session, ...index.sessions],
  });
  const storageKey = chatStorageKey(session.id);
  const chat = { messages: [], compactedSummary: "" };
  saveChat(userDataPath, storageKey, chat);
  return { index: nextIndex, session, storageKey, chat };
}

function renameChatSession(userDataPath, sessionId, title) {
  const index = ensureChatSessions(userDataPath);
  const cleaned = cleanChatTitle(title);
  if (!cleaned) {
    throw new Error("Chat title is empty.");
  }
  const sessions = index.sessions.map((session) =>
    session.id === sessionId ? { ...session, title: cleaned, updatedAt: new Date().toISOString() } : session,
  );
  return writeChatIndex(userDataPath, { ...index, sessions });
}

function deleteChatSession(userDataPath, sessionId) {
  const index = ensureChatSessions(userDataPath);
  const target = index.sessions.find((session) => session.id === sessionId);
  if (target) {
    const filePath = chatPath(userDataPath, chatStorageKey(target.id));
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }
  const remaining = index.sessions.filter((session) => session.id !== sessionId);
  if (!remaining.length) {
    return createNewChatSession(userDataPath);
  }
  const activeSessionId = index.activeSessionId === sessionId ? remaining[0].id : index.activeSessionId;
  const nextIndex = writeChatIndex(userDataPath, { ...index, activeSessionId, sessions: remaining });
  return activeChatState(userDataPath, activeSessionId);
}

function chatDiagnostics(userDataPath, state, promptPacketFilePath = "") {
  return {
    chatKey: state.storageKey,
    chatPath: chatPath(userDataPath, state.storageKey),
    promptPacketPath: promptPacketFilePath || existingPromptPacketPath(userDataPath, state.storageKey),
    userDataPath,
    activeChatId: state.session.id,
    chatSessions: publicChatSessions(state.index),
  };
}

function diagnosticsRoot(userDataPath) {
  return path.join(userDataPath, "diagnostics");
}

function promptPacketPath(userDataPath, key) {
  return path.join(diagnosticsRoot(userDataPath), "prompt-packets", `${key}.json`);
}

function existingPromptPacketPath(userDataPath, key) {
  const filePath = promptPacketPath(userDataPath, key);
  return fs.existsSync(filePath) ? filePath : "";
}

function sanitizePromptPacketContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return content ?? "";
  }
  return content.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    if (item.type === "image_url") {
      return {
        type: "image_url",
        image_url: {
          url: "[omitted viewport screenshot data]",
        },
      };
    }
    return item;
  });
}

function sanitizePromptPacketMessages(messages) {
  return (messages || []).map((message) => ({
    role: message.role,
    content: sanitizePromptPacketContent(message.content),
  }));
}

function writePromptPacket(filePath, { payload, prompt, context }) {
  writeJson(filePath, {
    version: 1,
    createdAt: new Date().toISOString(),
    note: "Exact text packet sent to LM Studio. Viewport screenshot data is intentionally omitted.",
    prompt,
    contextLine: context.contextLine || "",
    model: payload.model || "auto",
    temperature: payload.temperature,
    maxTokens: payload.max_tokens,
    stream: payload.stream,
    knowledgeStatus: context.promptParts?.knowledge_status || {},
    knowledgeSources: context.promptParts?.knowledge_sources || [],
    routerTrace: context.promptParts?.router_trace || {},
    selectedCards: context.promptParts?.knowledge_status?.selectedCards || [],
    messages: sanitizePromptPacketMessages(payload.messages),
  });
  return filePath;
}

function isPathInside(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath || "");
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function loadChat(userDataPath, key) {
  const fallback = { messages: [], compactedSummary: "" };
  const data = readJson(chatPath(userDataPath, key), fallback);
  return {
    messages: Array.isArray(data.messages) ? data.messages : [],
    compactedSummary: typeof data.compactedSummary === "string" ? data.compactedSummary : "",
  };
}

function saveChat(userDataPath, key, chat) {
  writeJson(chatPath(userDataPath, key), {
    version: 1,
    updatedAt: new Date().toISOString(),
    messages: chat.messages || [],
    compactedSummary: chat.compactedSummary || "",
  });
}

function settingsPath(userDataPath) {
  return path.join(userDataPath, "settings.json");
}

function loadBackendSettings(userDataPath) {
  return {
    ...defaultSettings(),
    ...readJson(settingsPath(userDataPath), {}),
  };
}

function bridgeDiscoveryPaths(userDataPath) {
  const paths = [path.join(userDataPath, "bridge.json")];
  if (process.env.APPDATA) {
    paths.push(path.join(process.env.APPDATA, "Blendy", "bridge.json"));
  }
  if (process.env.LOCALAPPDATA) {
    paths.push(path.join(process.env.LOCALAPPDATA, "Blendy", "bridge.json"));
  }
  return [...new Set(paths)];
}

function loadBridgeDiscovery(userDataPath) {
  for (const filePath of bridgeDiscoveryPaths(userDataPath)) {
    const data = readJson(filePath, null);
    if (!data || typeof data !== "object") {
      continue;
    }
    const url = typeof data.url === "string" ? data.url : "";
    const port = Number(data.port);
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return { ...data, url: normalizeBaseUrl(url, DEFAULT_BRIDGE_URL), path: filePath };
    }
    if (Number.isInteger(port) && port > 0) {
      return {
        ...data,
        url: `http://127.0.0.1:${port}`,
        path: filePath,
      };
    }
  }
  return null;
}

function resolveBridgeUrl(settings, userDataPath) {
  const saved = (settings.bridgeUrl || AUTO_BRIDGE_URL).trim();
  if (saved && saved !== AUTO_BRIDGE_URL && saved !== DEFAULT_BRIDGE_URL) {
    return {
      url: normalizeBaseUrl(saved, DEFAULT_BRIDGE_URL),
      source: "manual",
      discoveryPath: "",
    };
  }
  const discovery = loadBridgeDiscovery(userDataPath);
  if (discovery?.url) {
    return {
      url: discovery.url,
      source: "discovery",
      discoveryPath: discovery.path || "",
    };
  }
  return {
    url: DEFAULT_BRIDGE_URL,
    source: "default",
    discoveryPath: "",
  };
}

function saveBackendSettings(userDataPath, partial) {
  const next = {
    ...loadBackendSettings(userDataPath),
    ...partial,
  };
  writeJson(settingsPath(userDataPath), next);
  return next;
}

function shouldSendScreenshot(prompt, screenshotMode) {
  if (screenshotMode === "always") {
    return true;
  }
  if (screenshotMode === "never") {
    return false;
  }
  const lower = (prompt || "").toLowerCase();
  return VISUAL_PROMPT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isExplicitWebLookupRequest(prompt) {
  const lower = String(prompt || "").toLowerCase();
  return [
    "go look",
    "look online",
    "look it up",
    "look this up",
    "search online",
    "search the web",
    "web search",
    "run a web search",
    "use the internet",
    "check the internet",
    "google",
    "googling",
    "go hunting on the web",
  ].some((phrase) => lower.includes(phrase));
}

function isAffirmativeWebApproval(prompt) {
  const lower = String(prompt || "").trim().toLowerCase();
  return /^(yes|yeah|yep|sure|ok|okay|please do|do it|go ahead|approved|permission granted)\b/.test(lower)
    || lower.includes("you can web search")
    || lower.includes("you can search")
    || lower.includes("yes, look")
    || lower.includes("yes look")
    || lower.includes("go ahead and search");
}

function pendingWebLookupPrompt(messages) {
  const visible = (messages || []).filter(
    (message) => (message.role === "user" || message.role === "assistant") && String(message.content || "").trim(),
  );
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index];
    if (message.role !== "assistant") {
      continue;
    }
    const content = String(message.content || "").toLowerCase();
    const askedForPermission =
      content.includes("should i look")
      || content.includes("would you like me to")
      || content.includes("perform a web search")
      || content.includes("attempt a web search")
      || content.includes("look it up online")
      || content.includes("search online")
      || content.includes("web search");
    if (!askedForPermission) {
      continue;
    }
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      if (visible[prior].role === "user") {
        return String(visible[prior].content || "").trim();
      }
    }
  }
  return "";
}

function resolveWebApproval(prompt, messages) {
  const pendingPrompt = pendingWebLookupPrompt(messages);
  const explicit = isExplicitWebLookupRequest(prompt);
  const affirmative = isAffirmativeWebApproval(prompt);
  if (pendingPrompt && (explicit || affirmative)) {
    return { webApproved: true, webPrompt: pendingPrompt };
  }
  if (explicit) {
    return { webApproved: true, webPrompt: prompt };
  }
  return { webApproved: false, webPrompt: "" };
}

function bridgeHonoredWebApproval(context, webApproval) {
  if (!webApproval?.webApproved) {
    return true;
  }
  return Boolean(context.promptParts?.web_approved);
}

function staleBridgeWebApprovalMessage() {
  return [
    "I have your web-search permission, but the Blender bridge that is currently loaded did not accept it.",
    "",
    "That usually means Blender is still running an older copy of the Local AI add-on. Restart Blender or toggle the Local AI add-on off/on, then ask again.",
    "",
    "I did not search the web yet, and I do not want to fake a web result.",
  ].join("\n");
}

async function captureBridgeContext(settings, request = {}, userDataPath = "") {
  const screenshotMode = request.forceScreenshot
    ? "always"
    : shouldSendScreenshot(request.prompt, "auto")
      ? "auto"
      : "never";
  const body = {
    prompt: request.prompt || "",
    screenshot: screenshotMode,
    knowledgeMode: normalizeKnowledgeMode(settings.knowledgeMode),
    webApproved: Boolean(request.webApproved),
    webPrompt: request.webPrompt || "",
  };
  const bridge = resolveBridgeUrl(settings, userDataPath);
  try {
    const context = await fetchJson(
      `${bridge.url}/context`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      request.forceScreenshot ? 20000 : 12000,
    );
    return {
      ...context,
      ok: true,
      bridgeUrl: bridge.url,
      bridgeSource: bridge.source,
      bridgeDiscoveryPath: bridge.discoveryPath,
    };
  } catch (error) {
    return {
      ...defaultBridgeContext({ ...settings, bridgeUrl: bridge.url }, error.message || String(error)),
      bridgeUrl: bridge.url,
      bridgeSource: bridge.source,
      bridgeDiscoveryPath: bridge.discoveryPath,
    };
  }
}

function trimHistory(messages) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => (message.content || "").trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function shouldIncludeProjectBrief(prompt) {
  const lower = (prompt || "").toLowerCase();
  return PROJECT_BRIEF_PROMPT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function blenderVersionFromRuntime(runtimeFacts) {
  const match = BLENDER_VERSION_RE.exec(runtimeFacts || "");
  return match ? match[1].trim() : "";
}

function blenderVersionFromPrompt(prompt) {
  const match = USER_STATED_BLENDER_VERSION_RE.exec(prompt || "");
  return match ? match[1].trim() : "";
}

function blenderVersionLock(prompt, context) {
  const parts = context.promptParts || {};
  const runtimeVersion = context.bridge?.blenderVersion || blenderVersionFromRuntime(parts.runtime_facts || "");
  if (runtimeVersion) {
    return [
      `Active Blender runtime version: ${runtimeVersion}`,
      "Treat this as authoritative for all UI paths, menus, tool names, and shortcuts. If older Blender memory conflicts, ignore the older memory. If unsure about a version-specific UI detail, say you are unsure and give the safest way to find it in this Blender version.",
    ].join("\n");
  }
  const promptVersion = blenderVersionFromPrompt(prompt);
  if (promptVersion) {
    return [
      `User-stated Blender version: ${promptVersion}`,
      "No live runtime version was provided, so follow the user's stated version for this answer. Do not give instructions for a different Blender version unless you clearly say the detail may have changed.",
    ].join("\n");
  }
  return "No live Blender version was provided. Avoid version-specific claims when possible, and say when a UI path may vary by Blender version.";
}

function buildContextText(prompt, context, compactedSummary) {
  const parts = context.promptParts || {};
  if (typeof parts.context_text === "string" && parts.context_text.trim()) {
    return injectCompactedSummary(parts.context_text, compactedSummary);
  }
  const projectBrief = shouldIncludeProjectBrief(prompt)
    ? parts.truth_md || context.brief || "[Project Brief is missing or empty]"
    : "[omitted by default; ask about Project Brief, truth.md, project goal, requirements, or constraints to include it]";
  const visualStatus = [
    context.contextLine || "Used: Blender context unavailable",
    context.visual || "Viewport status unavailable",
    context.screenshotDataUrl ? "Viewport screenshot is attached to this message." : "No viewport screenshot is attached.",
  ].join("\n");
  return `USER PROMPT
${prompt.trim()}

ROUTER DECISION
${parts.router_decision || "[no router decision available]"}

BLENDER VERSION LOCK
${blenderVersionLock(prompt, context)}

VISUAL CONTEXT
${visualStatus}

BLENDER RUNTIME FACTS
${parts.runtime_facts || "[no Blender runtime facts available]"}

CURRENT BLENDER SCENE CONTEXT
${parts.scene_context || "[no scene context available]"}

SCENE CHANGES SINCE LAST PROMPT
${parts.scene_diff || "[no scene change summary available]"}

SCENE DIAGNOSTIC FLAGS
${parts.scene_diagnostic_flags || "[no scene diagnostic flags]"}

SEMANTIC SCENE CARD
${parts.semantic_scene_card || "[no semantic scene card available]"}

READ-ONLY VERIFICATION NOTES
${parts.verification_notes || "[no read-only verification notes available]"}

KNOWLEDGE REFERENCES
${parts.knowledge_references || "[no local official docs matched this prompt]"}

WEB REFERENCES
${parts.web_references || "[web lookup not run]"}

WORKFLOW CARDS
${parts.workflow_cards || "[no workflow shortcut cards selected]"}

TROUBLESHOOTING CARDS
${parts.troubleshooting_cards || "[no troubleshooting cards selected]"}

BLENDER TOOL REFERENCES
${parts.tool_references || "[no targeted tool references selected]"}

PROJECT BRIEF / TRUTH.MD
${projectBrief}

COMPACTED SESSION SUMMARY
${compactedSummary || "[no compacted session summary]"}`;
}

function injectCompactedSummary(contextText, compactedSummary) {
  const summary = compactedSummary || "[no compacted session summary]";
  const marker = "COMPACTED SESSION SUMMARY";
  const index = contextText.lastIndexOf(marker);
  if (index < 0) {
    return `${contextText.trim()}\n\n${marker}\n${summary}`;
  }
  return `${contextText.slice(0, index + marker.length)}\n${summary}`;
}

function buildChatPayload({ prompt, context, chat, settings }) {
  const contextText = buildContextText(prompt, context, chat.compactedSummary || "");
  const userContent = context.screenshotDataUrl
    ? [
        { type: "text", text: contextText },
        { type: "image_url", image_url: { url: context.screenshotDataUrl } },
      ]
    : contextText;
  return {
    model: settings.model === "auto" ? "" : settings.model,
    messages: [
      { role: "system", content: context.promptParts?.system_prompt || SYSTEM_PROMPT },
      ...trimHistory(chat.messages),
      { role: "user", content: userContent },
    ],
    temperature: 0.4,
    max_tokens: Math.max(256, Number(settings.responseMaxTokens || DEFAULT_RESPONSE_MAX_TOKENS)),
    stream: true,
  };
}

function visibleChatMessages(messages) {
  return (messages || [])
    .filter((message) => (message.role === "user" || message.role === "assistant") && (message.content || "").trim())
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000),
    }));
}

function compactMarkerMessage() {
  return {
    id: crypto.randomUUID(),
    role: "event",
    marker: "compacted",
    content: "Conversation compacted",
    status: "done",
  };
}

async function compactChatToSummary({ chat, settings }) {
  const transcript = visibleChatMessages(chat.messages);
  if (!transcript.length) {
    return chat;
  }

  const payload = buildCompactionPayload({ chat, settings });
  const summary = await runLmStudioCompletion({
    settings,
    payload,
    onDelta() {},
  });
  return {
    compactedSummary: summary,
    messages: [compactMarkerMessage()],
  };
}

function buildCompactionPayload({ chat, settings }) {
  const existing = (chat.compactedSummary || "").trim();
  const transcript = visibleChatMessages(chat.messages)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
  const userText = `Existing compacted summary:
${existing || "[none]"}

Transcript to compact:
${transcript || "[empty transcript]"}

Create a compact session memory for future Blender tutoring. Preserve the user's project goal, decisions, Blender units/defaults, current objects/settings, gotchas, and next steps. Do not invent facts.`;

  return {
    model: settings.model === "auto" ? "" : settings.model,
    messages: [
      {
        role: "system",
        content:
          "You compact a Blender tutoring chat into durable memory. Output only the compact summary. No headings unless useful.",
      },
      {
        role: "user",
        content: userText,
      },
    ],
    temperature: 0.2,
    max_tokens: 1200,
    stream: false,
  };
}

function messageContentToText(content, options = {}) {
  const shouldTrim = options.trim !== false;
  if (typeof content === "string") {
    return shouldTrim ? content.trim() : content;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((item) => (item && (item.text || item.content)) || "")
      .filter(Boolean)
      .join("\n")
    return shouldTrim ? text.trim() : text;
  }
  return "";
}

function isScaffoldLabel(line) {
  const normalized = line.replace(/^\s*\d+\.\s*/, "").trim().toLowerCase().replace(/:$/, "");
  return [
    "goal",
    "next tool",
    "next tool/mode to use",
    "next tool / mode to use",
    "exact steps",
    "check",
    "if it looks wrong",
    "what i think you are trying to make",
    "what to look for when it worked",
    "one fallback if the result looks wrong",
  ].includes(normalized);
}

function cleanModelText(text) {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/`/g, "")
    .replace(/\$\\rightarrow\$/g, "->")
    .replace(/\\rightarrow/g, "->")
    .replace(/\$/g, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/(^|[^*])\*([^*\n]+)\*(?=[^*]|$)/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !isScaffoldLabel(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cloneMessages(messages) {
  return JSON.parse(JSON.stringify(messages || []));
}

async function resolveModel(settings) {
  if (settings.model && settings.model !== "auto") {
    return settings.model;
  }
  const baseUrl = normalizeBaseUrl(settings.lmStudioBaseUrl, DEFAULT_LM_STUDIO_BASE_URL);
  const data = await fetchJson(`${baseUrl}/models`, { method: "GET" }, 10000);
  const first = Array.isArray(data.data) ? data.data.find((item) => item && item.id) : null;
  if (!first?.id) {
    throw new Error("LM Studio is reachable, but no loaded model was returned by /v1/models.");
  }
  return first.id;
}

async function repairBlankVisibleAnswer({ settings, payload, onDelta }) {
  const baseUrl = normalizeBaseUrl(settings.lmStudioBaseUrl, DEFAULT_LM_STUDIO_BASE_URL);
  const repairPayload = {
    model: payload.model,
    messages: [
      {
        role: "system",
        content:
          "You write only the final visible assistant answer. Do not include reasoning, scratchpad, labels, or analysis.",
      },
      ...cloneMessages(payload.messages),
      {
        role: "user",
        content:
          "Your previous completion did not include visible assistant content. Reply now with only the final answer for the user's last Blender question.",
      },
    ],
    temperature: 0.2,
    max_tokens: Math.min(2000, Math.max(512, Number(payload.max_tokens || 1200))),
    stream: false,
  };
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(repairPayload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status} from LM Studio repair request: ${detail || response.statusText}`);
  }
  const data = await response.json();
  const text = cleanModelText(messageContentToText(data.choices?.[0]?.message?.content));
  if (!text) {
    throw new Error(
      "LM Studio returned hidden reasoning but no visible answer. Try increasing Response max or switching to a non-reasoning instruct model.",
    );
  }
  onDelta(text);
  return text;
}

async function runLmStudioCompletion({ settings, payload, onDelta, beforeSend }) {
  const baseUrl = normalizeBaseUrl(settings.lmStudioBaseUrl, DEFAULT_LM_STUDIO_BASE_URL);
  payload.model = await resolveModel(settings);
  if (beforeSend) {
    beforeSend(payload);
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status} from LM Studio: ${detail || response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!payload.stream || !response.body || contentType.includes("application/json")) {
    const data = await response.json();
    const text = messageContentToText(data.choices?.[0]?.message?.content);
    const cleaned = cleanModelText(text);
    if (cleaned) {
      return cleaned;
    }
    return repairBlankVisibleAnswer({ settings, payload, onDelta });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let visible = "";
  let reasoning = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const dataText = trimmed.slice(5).trim();
      if (!dataText || dataText === "[DONE]") {
        continue;
      }
      let data;
      try {
        data = JSON.parse(dataText);
      } catch (_error) {
        continue;
      }
      const delta = data.choices?.[0]?.delta || {};
      const next = messageContentToText(delta.content, { trim: false });
      const nextReasoning = messageContentToText(delta.reasoning_content || delta.reasoning, { trim: false });
      if (next) {
        visible += next;
        onDelta(next);
      }
      if (nextReasoning) {
        reasoning += nextReasoning;
      }
    }
  }

  const cleaned = cleanModelText(visible);
  if (cleaned) {
    return cleaned;
  }
  return repairBlankVisibleAnswer({ settings, payload, onDelta });
}

function friendlyLmError(error) {
  const message = error.message || String(error);
  if (/fetch failed|ECONNREFUSED|Could not connect|Failed to fetch/i.test(message)) {
    return "I could not reach LM Studio. Start LM Studio's local server when you are ready, then send again.";
  }
  return message;
}

function registerBackendIpc({ app, ipcMain }) {
  const userDataPath = app.getPath("userData");

  async function getState() {
    const settings = loadBackendSettings(userDataPath);
    const context = await captureBridgeContext(settings, { prompt: "", forceScreenshot: false }, userDataPath);
    const state = activeChatState(userDataPath);
    const usage = estimateContextUsage({ context, chat: state.chat, settings });
    const packetPath = existingPromptPacketPath(userDataPath, state.storageKey);
    return {
      context: contextToSnapshot(context, userDataPath, usage, packetPath),
      messages: state.chat.messages,
      backendSettings: settings,
      diagnostics: chatDiagnostics(userDataPath, state, packetPath),
    };
  }

  function startAssistantCompletion({
    event,
    key,
    sessionId,
    chat,
    assistantMessage,
    prompt,
    context,
    settings,
    promptPacketFilePath,
  }) {
    const sender = event.sender;
    setTimeout(async () => {
      try {
        const payload = buildChatPayload({
          prompt,
          context,
          chat: { ...chat, messages: chat.messages.filter((message) => message.id !== assistantMessage.id) },
          settings,
        });
        const finalText = await runLmStudioCompletion({
          settings,
          payload,
          beforeSend(resolvedPayload) {
            if (promptPacketFilePath) {
              writePromptPacket(promptPacketFilePath, {
                payload: resolvedPayload,
                prompt,
                context,
              });
            }
          },
          onDelta(delta) {
            sender.send("blendy:chat-event", {
              type: "assistant-delta",
              id: assistantMessage.id,
              delta,
            });
          },
        });
        const fresh = loadChat(userDataPath, key);
        const target = fresh.messages.find((message) => message.id === assistantMessage.id);
        if (target) {
          target.content = finalText;
          target.status = "done";
        }
        saveChat(userDataPath, key, fresh);
        touchChatSession(userDataPath, sessionId, fresh, inferChatTitle(fresh));
        sender.send("blendy:chat-event", {
          type: "assistant-done",
          id: assistantMessage.id,
          content: finalText,
        });
      } catch (error) {
        const friendly = friendlyLmError(error);
        const fresh = loadChat(userDataPath, key);
        const target = fresh.messages.find((message) => message.id === assistantMessage.id);
        if (target) {
          target.content = friendly;
          target.status = "failed";
        }
        saveChat(userDataPath, key, fresh);
        touchChatSession(userDataPath, sessionId, fresh, inferChatTitle(fresh));
        sender.send("blendy:chat-event", {
          type: "assistant-error",
          id: assistantMessage.id,
          error: friendly,
        });
      }
    }, 0);
  }

  ipcMain.handle("blendy:get-state", getState);

  ipcMain.handle("blendy:save-backend-settings", (_event, partial) => {
    return saveBackendSettings(userDataPath, partial || {});
  });

  ipcMain.handle("blendy:refresh-context", async (_event, request = {}) => {
    const settings = loadBackendSettings(userDataPath);
    const context = await captureBridgeContext(settings, request, userDataPath);
    const state = activeChatState(userDataPath, request?.chatId || "");
    const usage = estimateContextUsage({ prompt: request.prompt || "", context, chat: state.chat, settings });
    return contextToSnapshot(context, userDataPath, usage, existingPromptPacketPath(userDataPath, state.storageKey));
  });

  ipcMain.handle("blendy:open-project-brief", async (_event, truthPath) => {
    if (!truthPath || !fs.existsSync(truthPath)) {
      return { ok: false, error: "Project Brief does not exist yet." };
    }
    const { shell } = require("electron");
    await shell.openPath(truthPath);
    return { ok: true };
  });

  ipcMain.handle("blendy:open-diagnostic-file", async (_event, filePath) => {
    const diagnosticsPath = diagnosticsRoot(userDataPath);
    if (!filePath || !isPathInside(diagnosticsPath, filePath) || !fs.existsSync(filePath)) {
      return { ok: false, error: "Diagnostic file does not exist inside Blendy app data." };
    }
    const { shell } = require("electron");
    await shell.openPath(filePath);
    return { ok: true };
  });

  ipcMain.handle("blendy:send-message", async (event, request) => {
    const prompt = (request?.prompt || "").trim();
    if (!prompt) {
      throw new Error("Prompt is empty.");
    }

    const settings = {
      ...loadBackendSettings(userDataPath),
      ...(request?.backendSettings || {}),
    };
    saveBackendSettings(userDataPath, settings);

    let context = await captureBridgeContext(
      settings,
      {
        prompt,
        forceScreenshot: false,
        webApproved: isExplicitWebLookupRequest(prompt),
        webPrompt: prompt,
      },
      userDataPath,
    );
    const state = activeChatState(userDataPath, request?.chatId || "");
    const key = state.storageKey;
    const packetPath = promptPacketPath(userDataPath, key);
    let chat = state.chat;
    const webApproval = resolveWebApproval(prompt, chat.messages);
    if (webApproval.webApproved && (!context.promptParts?.web_approved || webApproval.webPrompt !== prompt)) {
      context = await captureBridgeContext(
        settings,
        {
          prompt,
          forceScreenshot: false,
          webApproved: true,
          webPrompt: webApproval.webPrompt,
        },
        userDataPath,
      );
    }
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      context: context.contextLine || "Used: Blender context unavailable",
    };
    const receipt = assistantReceipt(context);
    const assistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      status: "streaming",
      context: receipt.line,
      receipt: receipt.details,
    };
    if (!bridgeHonoredWebApproval(context, webApproval)) {
      assistantMessage.content = staleBridgeWebApprovalMessage();
      assistantMessage.status = "done";
      chat.messages.push(userMessage, assistantMessage);
      saveChat(userDataPath, key, chat);
      const nextIndex = touchChatSession(userDataPath, state.session.id, chat, inferChatTitle(chat));
      const usage = estimateContextUsage({ prompt, context, chat, settings });
      return {
        userMessage,
        assistantMessage,
        context: contextToSnapshot(context, userDataPath, usage, packetPath),
        diagnostics: chatDiagnostics(userDataPath, { ...state, index: nextIndex, chat }, packetPath),
      };
    }
    const projectedChat = {
      ...chat,
      messages: [...chat.messages, userMessage],
    };
    const projectedUsage = estimateContextUsage({ prompt, context, chat: projectedChat, settings });
    let compactedBeforeSend = false;
    if (projectedUsage.tokens >= autoCompactThreshold(settings)) {
      chat = await compactChatToSummary({ chat, settings });
      compactedBeforeSend = true;
    }
    chat.messages.push(userMessage, assistantMessage);
    saveChat(userDataPath, key, chat);
    const nextIndex = touchChatSession(userDataPath, state.session.id, chat, inferChatTitle(chat));

    const usage = estimateContextUsage({ prompt, context, chat, settings });
    const contextSnapshot = contextToSnapshot(context, userDataPath, usage, packetPath);
    startAssistantCompletion({
      event,
      key,
      sessionId: state.session.id,
      chat,
      assistantMessage,
      prompt,
      context,
      settings,
      promptPacketFilePath: packetPath,
    });

    return {
      userMessage,
      assistantMessage,
      messages: compactedBeforeSend ? chat.messages : undefined,
      context: contextSnapshot,
      diagnostics: chatDiagnostics(userDataPath, { ...state, index: nextIndex, chat }, packetPath),
    };
  });

  ipcMain.handle("blendy:regenerate-last", async (event, request = {}) => {
    const settings = {
      ...loadBackendSettings(userDataPath),
      ...(request?.backendSettings || {}),
    };
    saveBackendSettings(userDataPath, settings);
    const state = activeChatState(userDataPath, request?.chatId || "");
    const context = await captureBridgeContext(settings, { prompt: "", forceScreenshot: false }, userDataPath);
    const key = state.storageKey;
    const packetPath = promptPacketPath(userDataPath, key);
    const chat = state.chat;
    const lastUser = [...chat.messages].reverse().find((message) => message.role === "user");
    if (!lastUser) {
      throw new Error("There is no user message to regenerate from.");
    }
    const webApproval = resolveWebApproval(lastUser.content, chat.messages);
    const refreshedContext = await captureBridgeContext(
      settings,
      {
        prompt: lastUser.content,
        forceScreenshot: false,
        webApproved: webApproval.webApproved || isExplicitWebLookupRequest(lastUser.content),
        webPrompt: webApproval.webPrompt || lastUser.content,
      },
      userDataPath,
    );
    const receipt = assistantReceipt(refreshedContext);
    const assistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      status: "streaming",
      context: receipt.line,
      receipt: receipt.details,
    };
    chat.messages.push(assistantMessage);
    saveChat(userDataPath, key, chat);
    const nextIndex = touchChatSession(userDataPath, state.session.id, chat, inferChatTitle(chat));
    const usage = estimateContextUsage({ prompt: lastUser.content, context: refreshedContext, chat, settings });
    startAssistantCompletion({
      event,
      key,
      sessionId: state.session.id,
      chat,
      assistantMessage,
      prompt: lastUser.content,
      context: refreshedContext,
      settings,
      promptPacketFilePath: packetPath,
    });
    return {
      assistantMessage,
      context: contextToSnapshot(refreshedContext, userDataPath, usage, packetPath),
      diagnostics: chatDiagnostics(userDataPath, { ...state, index: nextIndex, chat }, packetPath),
    };
  });

  ipcMain.handle("blendy:compact-chat", async (_event, request = {}) => {
    const settings = {
      ...loadBackendSettings(userDataPath),
      ...(request?.backendSettings || {}),
    };
    saveBackendSettings(userDataPath, settings);
    const context = await captureBridgeContext(settings, { prompt: "", forceScreenshot: false }, userDataPath);
    const state = activeChatState(userDataPath, request?.chatId || "");
    const key = state.storageKey;
    const chat = state.chat;
    const packetPath = existingPromptPacketPath(userDataPath, key);
    const transcript = visibleChatMessages(chat.messages);
    if (!transcript.length && !(chat.compactedSummary || "").trim()) {
      throw new Error("There is no conversation to compact yet.");
    }

    const nextChat = await compactChatToSummary({ chat, settings });
    saveChat(userDataPath, key, nextChat);
    const nextIndex = touchChatSession(userDataPath, state.session.id, nextChat, inferChatTitle(nextChat));
    const usage = estimateContextUsage({ context, chat: nextChat, settings });
    return {
      messages: nextChat.messages,
      context: contextToSnapshot(context, userDataPath, usage, packetPath),
      diagnostics: chatDiagnostics(userDataPath, { ...state, index: nextIndex, chat: nextChat }, packetPath),
    };
  });

  ipcMain.handle("blendy:fresh-chat", async (_event, request = {}) => {
    const settings = {
      ...loadBackendSettings(userDataPath),
      ...(request?.backendSettings || {}),
    };
    saveBackendSettings(userDataPath, settings);
    const context = await captureBridgeContext(settings, { prompt: "", forceScreenshot: false }, userDataPath);
    const state = createNewChatSession(userDataPath);
    const usage = estimateContextUsage({ context, chat: state.chat, settings });
    return {
      messages: state.chat.messages,
      context: contextToSnapshot(context, userDataPath, usage, existingPromptPacketPath(userDataPath, state.storageKey)),
      diagnostics: chatDiagnostics(userDataPath, state),
    };
  });

  ipcMain.handle("blendy:switch-chat", async (_event, request = {}) => {
    const settings = {
      ...loadBackendSettings(userDataPath),
      ...(request?.backendSettings || {}),
    };
    saveBackendSettings(userDataPath, settings);
    const state = activeChatState(userDataPath, request?.chatId || "");
    const context = await captureBridgeContext(settings, { prompt: "", forceScreenshot: false }, userDataPath);
    const packetPath = existingPromptPacketPath(userDataPath, state.storageKey);
    const usage = estimateContextUsage({ context, chat: state.chat, settings });
    return {
      messages: state.chat.messages,
      context: contextToSnapshot(context, userDataPath, usage, packetPath),
      diagnostics: chatDiagnostics(userDataPath, state, packetPath),
    };
  });

  ipcMain.handle("blendy:rename-chat", async (_event, request = {}) => {
    const index = renameChatSession(userDataPath, request?.chatId || "", request?.title || "");
    const state = activeChatState(userDataPath, request?.chatId || index.activeSessionId);
    return {
      diagnostics: chatDiagnostics(userDataPath, { ...state, index }),
    };
  });

  ipcMain.handle("blendy:delete-chat", async (_event, request = {}) => {
    const settings = {
      ...loadBackendSettings(userDataPath),
      ...(request?.backendSettings || {}),
    };
    saveBackendSettings(userDataPath, settings);
    const state = deleteChatSession(userDataPath, request?.chatId || "");
    const context = await captureBridgeContext(settings, { prompt: "", forceScreenshot: false }, userDataPath);
    const packetPath = existingPromptPacketPath(userDataPath, state.storageKey);
    const usage = estimateContextUsage({ context, chat: state.chat, settings });
    return {
      messages: state.chat.messages,
      context: contextToSnapshot(context, userDataPath, usage, packetPath),
      diagnostics: chatDiagnostics(userDataPath, state, packetPath),
    };
  });
}

module.exports = {
  registerBackendIpc,
};
