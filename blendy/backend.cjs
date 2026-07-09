const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8765";
const DEFAULT_LM_STUDIO_BASE_URL = "http://localhost:1234/v1";
const DEFAULT_RESPONSE_MAX_TOKENS = 2200;
const MAX_RESPONSE_MAX_TOKENS = 6000;
const TOOL_DECISION_MAX_TOKENS = 650;
const LM_STUDIO_COMPLETION_TIMEOUT_MS = 120000;
const TOOL_DECISION_TIMEOUT_MS = 30000;
const DEFAULT_CONTEXT_LIMIT_TOKENS = 70000;
const DEFAULT_AUTO_COMPACT_RATIO = 0.95;
const DEFAULT_TOOL_RESERVE_TOKENS = 3500;
const DEFAULT_IMAGE_RESERVE_TOKENS = 1200;
const MAX_USER_INSTRUCTIONS_CHARS = 6000;
const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_RESULT_CHARS = 6000;
const AUTO_BRIDGE_URL = "auto";
const TOOL_USE_AUTO = "AUTO";
const TOOL_USE_OFF = "OFF";
const KNOWLEDGE_MODE_LOCAL_AUTO_WEB = "LOCAL_AUTO_WEB";
const KNOWLEDGE_MODE_LOCAL_ONLY = "LOCAL_ONLY";
const KNOWLEDGE_MODE_ASK_BEFORE_WEB = "ASK_BEFORE_WEB";
const KNOWLEDGE_MODE_LABELS = {
  [KNOWLEDGE_MODE_LOCAL_AUTO_WEB]: "Local + Auto Web",
  [KNOWLEDGE_MODE_LOCAL_ONLY]: "Local Only",
  [KNOWLEDGE_MODE_ASK_BEFORE_WEB]: "Ask Before Web",
};
const activeAssistantMessageIds = new Set();
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

const SYSTEM_PROMPT = `You are Blendy, a local Blender tutor for beginner artists who want clear guidance and persistence. You live inside the user's local Blender workflow.

Primary user workflow:
- The user is a complete Blender beginner with strong product/design thinking.
- Your job is to prevent overwhelm by turning the current scene into the next small, doable Blender action.
- Keep the user moving through one clear checkpoint at a time.

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
- Use read-only tools when you need extra references. Local official docs are the authority for stable Blender facts; web results are allowed for current info, community workflow discoveries, add-ons, names, and examples, but label them by source quality.
- Use workflow and troubleshooting tool results as optional background notes, not a script or route. Ignore any note that does not fit the user's latest prompt, screenshot, or live scene facts.
- For ordinary tutoring questions, do not spend extended hidden reasoning deciding whether to use a tool. Make a fast choice: answer directly from screenshot and scene context when enough, or request one relevant read-only tool immediately.
- For open-ended visual effect, design, material, or workflow questions where examples would materially help, prefer one concise workflow_notes or web_search call over long internal deliberation.
- Use model memory only as background, never as stronger evidence than provided Blender facts.
- If the evidence is incomplete, say it naturally: "I can see...", "I'm inferring...", or "I can't tell from the current Blendy context."
- Do not invent Blender state, UI locations, file contents, object names, measurements, or actions you cannot verify from the provided context.
- If the user expects screen visibility but VISUAL CONTEXT says no screenshot is attached, state that plainly and answer only from scene/runtime facts. Do not claim you can see the screen.
- For node editor questions, trust the live node context inventory before Blender memory. Only name node controls, modes, sockets, dropdown values, or links that appear in CURRENT BLENDER SCENE CONTEXT, screenshot evidence, or cited docs. If node details are absent, say you cannot inspect the node internals from the current context.
- For "what do you see", "look at my screen", "I don't see X", and similar live-screen questions, do not use web search unless the user explicitly asks to search online. Web results cannot see the user's current Blender screen.
- If the user asks about Blender startup defaults, preferences, future new files, or general app behavior, answer that global Blender question instead of forcing the answer back to the current project units or scene.
- If the latest prompt is clearly not a Blender question, do not force the answer through Blender docs or the current scene. If WEB REFERENCES contains sources, answer the non-Blender question from those sources instead of saying you are only a Blender tutor. If no source is available, say the lookup did not return a usable source.
- If the current context and any tool results still do not support a confident answer, ask one clarifying question instead of inventing Blender steps.

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
- Use tool results as evidence notes. Do not dump them back; turn them into beginner steps and naturally mention when you checked the Blender manual, workflow notes, or web.
- Never claim you searched Google, checked the live web, found search results, or used online sources unless a web_search or fetch_url tool result with source URLs is present.
- Do not say you lack web access. If you need current or external information, request the web_search or fetch_url tool. If a lookup returns no usable snippet, say that plainly and ask whether to keep working from Blender context or try a more specific search phrase.
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
    toolUse: TOOL_USE_AUTO,
    userInstructions: "",
    knowledgeMode: KNOWLEDGE_MODE_LOCAL_AUTO_WEB,
  };
}

function normalizedResponseMaxTokens(value) {
  const raw = Number(value || DEFAULT_RESPONSE_MAX_TOKENS);
  if (!Number.isFinite(raw)) {
    return DEFAULT_RESPONSE_MAX_TOKENS;
  }
  return Math.min(MAX_RESPONSE_MAX_TOKENS, Math.max(256, Math.round(raw)));
}

function normalizedBackendSettings(settings = {}) {
  const next = {
    ...defaultSettings(),
    ...settings,
  };
  next.responseMaxTokens = normalizedResponseMaxTokens(next.responseMaxTokens);
  next.contextLimitTokens = Math.max(1000, Number(next.contextLimitTokens || DEFAULT_CONTEXT_LIMIT_TOKENS));
  next.toolUse = normalizeToolUse(next.toolUse);
  next.userInstructions = normalizedUserInstructions(next);
  return next;
}

function isAbortError(error) {
  return error?.name === "AbortError" || /aborted|aborterror/i.test(error?.message || String(error || ""));
}

function normalizedUserInstructions(settings = {}) {
  const text = String(settings.userInstructions || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (text.length <= MAX_USER_INSTRUCTIONS_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_USER_INSTRUCTIONS_CHARS - 14)}\n[truncated]`;
}

function normalizeToolUse(value) {
  const cleaned = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned === TOOL_USE_OFF ? TOOL_USE_OFF : TOOL_USE_AUTO;
}

function toolUseEnabled(settings = {}) {
  return normalizeToolUse(settings.toolUse) !== TOOL_USE_OFF;
}

const LOCAL_BLENDER_DOCS = [
  {
    title: "Apply - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/scene_layout/object/editing/apply.html",
    keywords: ["apply scale", "ctrl a scale", "scale not 1", "transform apply", "bevel looks wrong"],
    summary:
      "Apply Scale makes Blender treat the object's current size as its normal transform basis. For modifier weirdness, check Object Mode, selected object, then Ctrl+A > Scale before judging the modifier.",
  },
  {
    title: "Bevel Modifier - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/bevel.html",
    keywords: ["bevel modifier", "bevel does nothing", "round corners", "rounded edges", "chamfer", "segments", "clamp overlap"],
    summary:
      "The Bevel modifier bevels mesh edges non-destructively. If it appears to do nothing, verify selected mesh, viewport visibility, Amount relative to scene units, object scale, and Clamp Overlap.",
  },
  {
    title: "Curve Geometry - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/modeling/curves/properties/geometry.html",
    keywords: ["curve bevel depth", "bevel depth", "cable", "wire", "cord", "hose", "bend", "flexible", "curved tube"],
    summary:
      "Curve objects can be given thickness through Geometry > Bevel Depth, making a smooth bent tube without many mesh loop cuts.",
  },
  {
    title: "Inset Faces - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/modeling/meshes/editing/face/inset_faces.html",
    keywords: ["inset", "screen border", "panel", "rim", "face inside", "button recess", "port recess"],
    summary:
      "Inset Faces creates an inner border on selected faces, useful for panels, screens, rims, and recesses. Start in Edit Mode, Face Select, with the face selected.",
  },
  {
    title: "Loop Cut and Slide - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/modeling/meshes/editing/edge/loopcut_slide.html",
    keywords: ["loop cut", "ctrl r", "support loop", "edge loop", "add segment", "topology"],
    summary:
      "Loop Cut and Slide adds edge loops through connected faces. It works best on clean quad topology and can stop early on triangles or n-gons.",
  },
  {
    title: "Solidify Modifier - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/solidify.html",
    keywords: ["solidify", "thickness", "thin surface", "shell", "case", "wall thickness"],
    summary: "Solidify adds thickness to surfaces and shells. For beginners, leave it as a modifier while tuning thickness.",
  },
  {
    title: "Mirror Modifier - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/mirror.html",
    keywords: ["mirror", "symmetry", "symmetrical", "left and right", "both sides", "mirror line"],
    summary: "Mirror uses the object's origin and chosen axes to repeat geometry. If the result is offset, check origin and axis first.",
  },
  {
    title: "Object Origin - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/scene_layout/object/origin.html",
    keywords: ["origin", "pivot", "center point", "rotate around", "mirror line", "off center"],
    summary:
      "The object origin is the object's anchor for transforms and many modifiers; pivot settings control what point operations rotate or scale around.",
  },
  {
    title: "Normals - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/modeling/meshes/editing/mesh/normals.html",
    keywords: ["normal", "normals", "inside out", "black face", "weird shading", "recalculate outside"],
    summary:
      "Normals are surface directions used for shading and visibility. If faces shade inconsistently, use Edit Mode, select all, Mesh > Normals > Recalculate Outside.",
  },
  {
    title: "Shade Smooth and Flat - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/scene_layout/object/editing/shading.html",
    keywords: ["shade smooth", "shade flat", "faceted", "smooth shading", "sharp edges"],
    summary:
      "Shade Smooth changes how lighting is interpolated across faces; it does not add geometry. Crisp product edges may still need bevels or sharp normals.",
  },
  {
    title: "Cameras - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/render/cameras.html",
    keywords: ["camera", "frame", "framing", "composition", "numpad 0", "product shot", "camera view"],
    summary: "The camera defines what the render sees. Inspect camera view before rendering and frame important silhouettes cleanly.",
  },
  {
    title: "Principled BSDF - Blender Manual",
    url: "https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/principled.html",
    keywords: ["material", "principled", "bsdf", "color", "roughness", "metallic", "glass", "screen material"],
    summary:
      "Most beginner materials can start with the Principled BSDF controls: base color, metallic, roughness, alpha/transmission where available, then tune under actual lighting.",
  },
  {
    title: "Blender Release Notes",
    url: "https://developer.blender.org/docs/release_notes/",
    keywords: ["version", "changed", "release notes", "new in blender", "deprecated", "ui changed"],
    summary: "Version-sensitive claims should be checked against Blender release notes and the live runtime version instead of stale memory.",
  },
  {
    title: "Blender Python API",
    url: "https://docs.blender.org/api/current/index.html",
    keywords: ["python", "script", "api", "bpy", "operator", "code"],
    summary: "The Python API is the source for scripting details. Do not provide Blender Python unless the user explicitly asks for code.",
  },
];

const BLENDY_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_blender_docs",
      description: "Search local official Blender documentation snippets for stable Blender UI, modifier, material, render, and API facts.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The Blender topic to search for." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_workflow_notes",
      description: "Search Blendy's local workflow and troubleshooting notes for practical beginner modeling patterns and common failure modes.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The workflow or troubleshooting situation to search for." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the public web for current, external, or non-local information. Use for latest releases, add-ons, names, current facts, visual effect examples, community workflow discoveries, and design references.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The web search query." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "Fetch and summarize an HTTPS page. Use after web_search or when the user gives a specific URL.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "An HTTPS URL to fetch." },
        },
        required: ["url"],
      },
    },
  },
];

function toolDefinitionTokens() {
  return estimateTokens(JSON.stringify(BLENDY_TOOL_DEFINITIONS));
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
    visual: "Blender screen not captured",
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

function shouldReserveImageTokens(prompt, context) {
  if (context?.screenshotDataUrl || context?.used?.screenshot) {
    return true;
  }
  if (String(prompt || "").trim()) {
    return true;
  }
  if (!context?.ok) {
    return false;
  }
  const visual = String(context.visual || "").toLowerCase();
  if (visual.includes("failed") || visual.includes("not captured")) {
    return false;
  }
  return true;
}

function autoCompactThreshold(settings) {
  const limit = Math.max(1000, Number(settings.contextLimitTokens || DEFAULT_CONTEXT_LIMIT_TOKENS));
  return Math.floor(limit * DEFAULT_AUTO_COMPACT_RATIO);
}

function tokenizeQuery(query) {
  return String(query || "")
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
}

function scoreSearchText(query, text, keywords = []) {
  const haystack = String(text || "").toLowerCase();
  const queryTokens = tokenizeQuery(query);
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  for (const keyword of keywords) {
    const clean = String(keyword || "").toLowerCase();
    if (clean && haystack.includes(clean)) {
      score += 2;
    }
    if (clean && String(query || "").toLowerCase().includes(clean)) {
      score += 4;
    }
  }
  return score;
}

function formatToolItems(items, emptyMessage) {
  if (!items.length) {
    return emptyMessage;
  }
  return items
    .map((item, index) => {
      const lines = [
        `${index + 1}. ${item.title || "Untitled"}`,
        item.url ? `Source: ${item.url}` : "",
        item.authority ? `Authority: ${item.authority}` : "",
        item.summary || item.notes || "",
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
}

function searchLocalBlenderDocs(query) {
  const scored = LOCAL_BLENDER_DOCS
    .map((entry) => ({
      ...entry,
      authority: "official Blender docs",
      score: scoreSearchText(query, `${entry.title}\n${entry.summary}\n${entry.keywords.join(" ")}`, entry.keywords),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  return formatToolItems(scored, "No local official Blender doc snippets matched that query.");
}

function workflowDataPaths() {
  const candidates = [
    path.join(__dirname, "..", "..", "local_ai_chat", "data"),
    path.join(process.resourcesPath || "", "blender-addons", "local_ai_chat", "data"),
  ];
  return [...new Set(candidates)].filter(Boolean);
}

function readWorkflowCards() {
  const cards = [];
  for (const dir of workflowDataPaths()) {
    for (const fileName of ["blendy_veteran_cards.json", "blendy_veteran_cards_expansion.json"]) {
      const filePath = path.join(dir, fileName);
      const data = readJson(filePath, null);
      const rawCards = Array.isArray(data?.cards) ? data.cards : Array.isArray(data) ? data : [];
      for (const card of rawCards) {
        if (card && typeof card === "object") {
          cards.push(card);
        }
      }
    }
    if (cards.length) {
      break;
    }
  }
  return cards;
}

function cardSearchText(card) {
  return [
    card.id,
    card.title,
    card.type,
    card.better_move || card.betterMove,
    card.diagnosis_order || card.diagnosisOrder,
    card.beginner_steps,
    card.notes,
    ...(Array.isArray(card.likely_causes) ? card.likely_causes : []),
    ...(Array.isArray(card.what_blendy_should_avoid) ? card.what_blendy_should_avoid : []),
    ...(Array.isArray(card.triggers) ? card.triggers : []),
    ...(Array.isArray(card.keywords) ? card.keywords : []),
  ]
    .filter(Boolean)
    .join("\n");
}

function searchWorkflowNotes(query) {
  const scored = readWorkflowCards()
    .map((card) => ({
      title: card.title || card.id || "Workflow note",
      authority: card.type === "troubleshooting" ? "local troubleshooting note" : "local workflow note",
      summary:
        card.better_move
        || card.betterMove
        || card.diagnosis_order
        || card.diagnosisOrder
        || card.beginner_steps
        || card.notes
        || "",
      score: scoreSearchText(query, cardSearchText(card), [
        ...(Array.isArray(card.triggers) ? card.triggers : []),
        ...(Array.isArray(card.keywords) ? card.keywords : []),
      ]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  return formatToolItems(scored, "No local workflow or troubleshooting notes matched that query.");
}

function stripHtml(raw) {
  return String(raw || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function relevantSnippet(text, query, limit = 900) {
  const clean = stripHtml(text);
  if (clean.length <= limit) {
    return clean;
  }
  const tokens = tokenizeQuery(query).filter((token) => token.length > 3);
  const lower = clean.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    index = lower.indexOf(token);
    if (index >= 0) {
      break;
    }
  }
  const start = Math.max(0, index < 0 ? 0 : index - Math.floor(limit / 3));
  return `${start > 0 ? "..." : ""}${clean.slice(start, start + limit)}${start + limit < clean.length ? "..." : ""}`;
}

function assertHttpsUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch (_error) {
    throw new Error("URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) {
    throw new Error("Only HTTPS URLs can be fetched.");
  }
  return parsed.toString();
}

async function fetchUrlSnippet(url, query = "") {
  const safeUrl = assertHttpsUrl(url);
  const response = await fetch(safeUrl, {
    headers: {
      "User-Agent": "Blendy/1.0 local tutor read-only fetch",
      "Accept": "text/html,text/plain,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${safeUrl}`);
  }
  const raw = await response.text();
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  const title = titleMatch ? stripHtml(titleMatch[1]) : safeUrl;
  return formatToolItems(
    [
      {
        title,
        url: safeUrl,
        authority: "live HTTPS page",
        summary: relevantSnippet(raw, query || safeUrl, 1400),
      },
    ],
    "The page was fetched, but no readable text was found.",
  );
}

function parseSearchResults(raw, query) {
  const results = [];
  const seen = new Set();
  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(raw)) && results.length < 6) {
    let url = match[1].replace(/&amp;/g, "&");
    const title = stripHtml(match[2]);
    if (!title || /duckduckgo|feedback|settings|privacy/i.test(title)) {
      continue;
    }
    if (url.startsWith("//duckduckgo.com/l/?")) {
      const parsed = new URL(`https:${url}`);
      url = parsed.searchParams.get("uddg") || url;
    } else if (url.startsWith("/l/?")) {
      const parsed = new URL(`https://duckduckgo.com${url}`);
      url = parsed.searchParams.get("uddg") || url;
    }
    try {
      url = assertHttpsUrl(decodeURIComponent(url));
    } catch (_error) {
      continue;
    }
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    results.push({
      title,
      url,
      authority: "web search result",
      summary: `Search result for "${query}". Use fetch_url on this URL if more detail is needed.`,
    });
  }
  return results;
}

async function webSearch(query) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) {
    throw new Error("Search query is empty.");
  }
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Blendy/1.0 local tutor read-only search",
      "Accept": "text/html",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while searching the web.`);
  }
  const raw = await response.text();
  const results = parseSearchResults(raw, cleanQuery);
  return formatToolItems(results, "Web search returned no parseable HTTPS results.");
}

async function runBlendyToolCall(toolCall) {
  const name = toolCall?.function?.name || "";
  let args = {};
  try {
    args = JSON.parse(toolCall?.function?.arguments || "{}");
  } catch (_error) {
    throw new Error(`Tool ${name || "[unknown]"} received invalid JSON arguments.`);
  }
  if (name === "search_blender_docs") {
    return searchLocalBlenderDocs(args.query);
  }
  if (name === "search_workflow_notes") {
    return searchWorkflowNotes(args.query);
  }
  if (name === "web_search") {
    return webSearch(args.query);
  }
  if (name === "fetch_url") {
    return fetchUrlSnippet(args.url, args.query || "");
  }
  throw new Error(`Unknown tool requested: ${name || "[missing name]"}.`);
}

function estimateContextUsage({ prompt = "", context, chat, settings, extraMessages = [] }) {
  const limit = Math.max(1000, Number(settings.contextLimitTokens || DEFAULT_CONTEXT_LIMIT_TOKENS));
  const toolsEnabled = toolUseEnabled(settings);
  const contextText = buildContextText(prompt, context, chat.compactedSummary || "", { includeRetrieval: false, settings });
  const systemPrompt = context.promptParts?.system_prompt || SYSTEM_PROMPT;
  const historyText = trimHistory(chat.messages)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");
  const extraText = (extraMessages || [])
    .map((message) => `${message.role || ""}: ${message.name || ""} ${message.content || ""}`)
    .join("\n\n");
  const baselineTokens = estimateTokens(`${systemPrompt}\n\n${contextText}`);
  const historyTokens = estimateTokens(historyText);
  const promptTokens = estimateTokens(prompt);
  const toolDefinitionTokenCount = toolsEnabled ? toolDefinitionTokens() : 0;
  const toolReserveTokens = toolsEnabled ? DEFAULT_TOOL_RESERVE_TOKENS : 0;
  const imageReserveTokens = shouldReserveImageTokens(prompt, context) ? DEFAULT_IMAGE_RESERVE_TOKENS : 0;
  const toolRuntimeTokens = estimateTokens(extraText);
  const tokens = baselineTokens + historyTokens + toolDefinitionTokenCount + toolReserveTokens + imageReserveTokens + toolRuntimeTokens;
  return {
    tokens,
    limit,
    percent: contextPercent(tokens, limit),
    status: contextStatus(tokens, limit),
    baselineTokens,
    historyTokens,
    promptTokens,
    toolDefinitionTokens: toolDefinitionTokenCount,
    toolReserveTokens,
    imageReserveTokens,
    toolRuntimeTokens,
    availableForConversationTokens: Math.max(
      0,
      limit - baselineTokens - toolDefinitionTokenCount - toolReserveTokens - imageReserveTokens,
    ),
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
    visual: context.visual || "Blender screen not captured",
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
    toolDefinitionTokens: usage?.toolDefinitionTokens || 0,
    toolReserveTokens: usage?.toolReserveTokens || 0,
    imageReserveTokens: usage?.imageReserveTokens || 0,
    toolRuntimeTokens: usage?.toolRuntimeTokens || 0,
    availableForConversationTokens: usage?.availableForConversationTokens || 0,
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

function cleanReceiptSentence(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, "; ")
    .trim()
    .replace(/[.?!]+$/g, "");
}

function plainCardSummary(card) {
  const title = cleanReceiptSentence(card.title || card.id || "selected card");
  const betterMove = cleanReceiptSentence(card.betterMove);
  const diagnosisOrder = cleanReceiptSentence(card.diagnosisOrder);
  const reason = cleanReceiptSentence(Array.isArray(card.reasons) ? card.reasons[0] : "");
  const plainPoint = betterMove || diagnosisOrder || reason || title;

  if (card.type === "workflow_shortcut") {
    return `Blendy used a workflow shortcut: ${plainPoint}.`;
  }
  if (card.type === "troubleshooting") {
    return `Blendy used a troubleshooting card: ${plainPoint}.`;
  }
  return `Blendy used this reference because it matched the situation: ${plainPoint}.`;
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
  })).map((card) => ({
    ...card,
    plainSummary: plainCardSummary(card),
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
  const sortedSessions = sortChatSessions(normalizedSessions);
  const activeSessionId = sortedSessions.some((session) => session.id === raw.activeSessionId)
    ? raw.activeSessionId
    : sortedSessions[0]?.id || "";
  return {
    version: 1,
    activeSessionId,
    sessions: sortedSessions,
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
  const activeStillExists = remaining.some((session) => session.id === index.activeSessionId);
  const activeSessionId = index.activeSessionId !== sessionId && activeStillExists ? index.activeSessionId : remaining[0].id;
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
          url: "[omitted Blender screen screenshot data]",
        },
      };
    }
    return item;
  });
}

function sanitizePromptPacketMessages(messages) {
  return (messages || []).map((message) => {
    const clean = {
      role: message.role,
      content: sanitizePromptPacketContent(message.content),
    };
    if (message.name) {
      clean.name = message.name;
    }
    if (message.tool_call_id) {
      clean.tool_call_id = message.tool_call_id;
    }
    if (Array.isArray(message.tool_calls)) {
      clean.tool_calls = message.tool_calls;
    }
    return clean;
  });
}

function writePromptPacket(filePath, { payload, prompt, context, toolTrace = [], contextUsage = null }) {
  writeJson(filePath, {
    version: 1,
    createdAt: new Date().toISOString(),
    note: "Exact text packet sent to LM Studio. Blender screen screenshot data is intentionally omitted.",
    prompt,
    contextLine: context.contextLine || "",
    model: payload.model || "auto",
    temperature: payload.temperature,
    maxTokens: payload.max_tokens,
    stream: payload.stream,
    toolChoice: payload.tool_choice || "none",
    toolsOffered: Array.isArray(payload.tools) ? payload.tools.map((tool) => tool.function?.name || "") : [],
    toolTrace,
    contextUsage,
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
  let repairedStreaming = false;
  const messages = (Array.isArray(data.messages) ? data.messages : []).map((message) => {
    if (message?.role !== "assistant" || message.status !== "streaming" || activeAssistantMessageIds.has(message.id)) {
      return message;
    }
    repairedStreaming = true;
    return {
      ...message,
      content: message.content || "The previous response was interrupted before Blendy finished. You can send a new message in this chat.",
      status: "failed",
    };
  });
  if (repairedStreaming) {
    writeJson(chatPath(userDataPath, key), {
      version: 1,
      updatedAt: new Date().toISOString(),
      messages,
      compactedSummary: typeof data.compactedSummary === "string" ? data.compactedSummary : "",
    });
  }
  return {
    messages,
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
  return normalizedBackendSettings(readJson(settingsPath(userDataPath), {}));
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
  const next = normalizedBackendSettings({
    ...loadBackendSettings(userDataPath),
    ...partial,
  });
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
  return Boolean(String(prompt || "").trim());
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
    knowledgeMode: toolUseEnabled(settings) ? "TOOL_USE" : normalizeKnowledgeMode(settings.knowledgeMode),
    webApproved: false,
    webPrompt: "",
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

function buildContextText(prompt, context, compactedSummary, options = {}) {
  const includeRetrieval = options.includeRetrieval === true;
  const userInstructions = normalizedUserInstructions(options.settings || {});
  const parts = context.promptParts || {};
  if (includeRetrieval && typeof parts.context_text === "string" && parts.context_text.trim()) {
    return injectCompactedSummary(parts.context_text, compactedSummary);
  }
  const projectBrief = shouldIncludeProjectBrief(prompt)
    ? parts.truth_md || context.brief || "[Project Brief is missing or empty]"
    : "[omitted by default; ask about Project Brief, truth.md, project goal, requirements, or constraints to include it]";
  const visualStatus = [
    context.contextLine || "Used: Blender context unavailable",
    context.visual || "Viewport status unavailable",
    context.screenshotDataUrl ? "Blender screen screenshot is attached to this message." : "No Blender screen screenshot is attached.",
    context.screenshotDataUrl ? "Screen visibility check: Blendy may answer from the attached screenshot and scene data." : "Screen visibility check: no screenshot reached the model; if the user expects screen visibility, say this and answer only from runtime/scene facts.",
  ].join("\n");
  return `USER PROMPT
${prompt.trim()}

TOOL USE
Read-only tools are available when you need Blender docs, workflow notes, web search, or a fetched HTTPS page. Do not claim you used a source unless a tool result is present in this conversation.

USER INSTRUCTIONS
${userInstructions || "[no user instructions saved]"}

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

function buildChatPayload({ prompt, context, chat, settings, includeTools = true }) {
  const contextText = buildContextText(prompt, context, chat.compactedSummary || "", { includeRetrieval: false, settings });
  const userContent = context.screenshotDataUrl
    ? [
        { type: "text", text: contextText },
        { type: "image_url", image_url: { url: context.screenshotDataUrl } },
      ]
    : contextText;
  const payload = {
    model: settings.model === "auto" ? "" : settings.model,
    messages: [
      { role: "system", content: context.promptParts?.system_prompt || SYSTEM_PROMPT },
      ...trimHistory(chat.messages),
      { role: "user", content: userContent },
    ],
    temperature: 0.4,
    max_tokens: normalizedResponseMaxTokens(settings.responseMaxTokens),
    stream: true,
  };
  if (includeTools && toolUseEnabled(settings)) {
    payload.tools = BLENDY_TOOL_DEFINITIONS;
    payload.tool_choice = "auto";
  }
  return payload;
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
    max_tokens: Math.min(1600, Math.max(512, Number(payload.max_tokens || 1200))),
    stream: false,
  };
  const timeout = withTimeout(LM_STUDIO_COMPLETION_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(repairPayload),
      signal: timeout.controller.signal,
    });
  } finally {
    timeout.done();
  }
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
  payload.max_tokens = normalizedResponseMaxTokens(payload.max_tokens);
  if (beforeSend) {
    beforeSend(payload);
  }
  const timeout = withTimeout(LM_STUDIO_COMPLETION_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: timeout.controller.signal,
    });
  } finally {
    timeout.done();
  }
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

async function runLmStudioJsonMessage({ settings, payload, timeoutMs = LM_STUDIO_COMPLETION_TIMEOUT_MS }) {
  const baseUrl = normalizeBaseUrl(settings.lmStudioBaseUrl, DEFAULT_LM_STUDIO_BASE_URL);
  payload.max_tokens = normalizedResponseMaxTokens(payload.max_tokens);
  const timeout = withTimeout(timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: timeout.controller.signal,
    });
  } finally {
    timeout.done();
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status} from LM Studio: ${detail || response.statusText}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message || {};
}

function truncateToolResult(text) {
  const clean = String(text || "").trim();
  if (clean.length <= MAX_TOOL_RESULT_CHARS) {
    return clean;
  }
  return `${clean.slice(0, MAX_TOOL_RESULT_CHARS - 28)}\n[tool result truncated]`;
}

function compactToolCallForTrace(toolCall) {
  return {
    id: toolCall.id || "",
    name: toolCall.function?.name || "",
    arguments: toolCall.function?.arguments || "{}",
  };
}

function modelLooksLikeMalformedToolCall(message) {
  const text = messageContentToText(message.content);
  return /<tool_call|tool_calls|function_call/i.test(text) && /search_blender_docs|search_workflow_notes|web_search|fetch_url/i.test(text);
}

async function runLmStudioCompletionWithTools({
  settings,
  payload,
  onDelta,
  onDiagnostic,
  prompt,
  context,
  chat,
}) {
  if (!toolUseEnabled(settings)) {
    return runLmStudioCompletion({ settings, payload: { ...payload, tools: undefined, tool_choice: undefined }, onDelta, beforeSend: onDiagnostic });
  }

  const resolvedModel = await resolveModel(settings);
  const basePayload = {
    ...payload,
    model: resolvedModel,
    stream: false,
    tools: BLENDY_TOOL_DEFINITIONS,
    tool_choice: "auto",
  };
  const messages = cloneMessages(basePayload.messages);
  const baseMessageCount = messages.length;
  const toolTrace = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const requestPayload = {
      ...basePayload,
      messages,
      stream: false,
      temperature: 0.2,
      max_tokens: Math.min(TOOL_DECISION_MAX_TOKENS, normalizedResponseMaxTokens(settings.responseMaxTokens)),
      tools: BLENDY_TOOL_DEFINITIONS,
      tool_choice: "auto",
    };
    onDiagnostic?.(requestPayload, toolTrace);
    let message;
    try {
      message = await runLmStudioJsonMessage({ settings, payload: requestPayload, timeoutMs: TOOL_DECISION_TIMEOUT_MS });
    } catch (error) {
      if (!isAbortError(error) || round > 0) {
        throw error;
      }
      toolTrace.push({
        round: round + 1,
        call: { id: "", name: "tool_decision_timeout", arguments: "{}" },
        ok: false,
        resultPreview: "Tool-decision request timed out, so Blendy fell back to a direct streamed answer without tools for this turn.",
      });
      const fallbackPayload = {
        ...basePayload,
        messages,
        stream: true,
        max_tokens: normalizedResponseMaxTokens(settings.responseMaxTokens),
      };
      delete fallbackPayload.tools;
      delete fallbackPayload.tool_choice;
      onDiagnostic?.(fallbackPayload, toolTrace);
      return runLmStudioCompletion({ settings, payload: fallbackPayload, onDelta });
    }
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (!toolCalls.length) {
      if (modelLooksLikeMalformedToolCall(message)) {
        throw new Error(
          "The loaded local model tried to use a tool, but LM Studio did not return a valid tool_calls object. Switch to a tool-capable instruct model in LM Studio, then try again.",
        );
      }
      const finalText = cleanModelText(messageContentToText(message.content));
      if (finalText) {
        onDelta(finalText);
        return finalText;
      }
      return repairBlankVisibleAnswer({
        settings,
        payload: { ...requestPayload, tools: undefined, tool_choice: undefined },
        onDelta,
      });
    }

    messages.push({
      role: "assistant",
      content: message.content || "",
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const traceItem = {
        round: round + 1,
        call: compactToolCallForTrace(toolCall),
        ok: false,
        resultPreview: "",
      };
      try {
        const result = truncateToolResult(await runBlendyToolCall(toolCall));
        traceItem.ok = true;
        traceItem.resultPreview = result.slice(0, 1000);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id || `${toolCall.function?.name || "tool"}-${round}`,
          name: toolCall.function?.name || "tool",
          content: result,
        });
      } catch (error) {
        const result = `Tool error: ${error.message || String(error)}`;
        traceItem.resultPreview = result;
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id || `${toolCall.function?.name || "tool"}-${round}`,
          name: toolCall.function?.name || "tool",
          content: result,
        });
      }
      toolTrace.push(traceItem);
    }

    const usage = estimateContextUsage({
      prompt,
      context,
      chat,
      settings,
      extraMessages: messages.slice(baseMessageCount),
    });
    if (usage.tokens >= usage.limit) {
      throw new Error(
        "The requested tool results exceeded Blendy's context budget. Try a narrower question or compact the chat before asking again.",
      );
    }
  }

  const finalPayload = {
    ...basePayload,
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "You have reached the tool-call limit. Use the tool results already shown above and provide the best final answer now without calling more tools.",
      },
    ],
    stream: true,
  };
  delete finalPayload.tools;
  delete finalPayload.tool_choice;
  onDiagnostic?.(finalPayload, toolTrace);
  return runLmStudioCompletion({ settings, payload: finalPayload, onDelta });
}

function friendlyLmError(error) {
  const message = error.message || String(error);
  if (isAbortError(error)) {
    return "LM Studio spent too long thinking before returning an answer. I stopped the request so Blendy would not hang. Try sending again, or use a lower-thinking/non-reasoning model preset for fast tutoring prompts.";
  }
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
    activeAssistantMessageIds.add(assistantMessage.id);
    setTimeout(async () => {
      try {
        const payload = buildChatPayload({
          prompt,
          context,
          chat: { ...chat, messages: chat.messages.filter((message) => message.id !== assistantMessage.id) },
          settings,
        });
        const writeDiagnostics = (resolvedPayload, toolTrace = []) => {
          if (promptPacketFilePath) {
            writePromptPacket(promptPacketFilePath, {
              payload: resolvedPayload,
              prompt,
              context,
              toolTrace,
              contextUsage: estimateContextUsage({ prompt, context, chat, settings }),
            });
          }
        };
        const finalText = await runLmStudioCompletionWithTools({
          settings,
          payload,
          prompt,
          context,
          chat,
          onDiagnostic: writeDiagnostics,
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
      } finally {
        activeAssistantMessageIds.delete(assistantMessage.id);
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
      },
      userDataPath,
    );
    const state = activeChatState(userDataPath, request?.chatId || "");
    const key = state.storageKey;
    const packetPath = promptPacketPath(userDataPath, key);
    let chat = state.chat;
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
    const refreshedContext = await captureBridgeContext(
      settings,
      {
        prompt: lastUser.content,
        forceScreenshot: false,
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
