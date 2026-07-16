const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const backendPath = path.join(repoRoot, "blendy", "electron", "backend.cjs");
const backendSource =
  fs.readFileSync(backendPath, "utf8") +
  "\nmodule.exports.__test__ = { writePromptPacket, sanitizePromptPacketMessages, cleanModelText, buildChatPayload, buildContextText, estimateContextUsage, contextToSnapshot, runLmStudioCompletionWithTools, assistantContextLine, assistantReceipt, assistantReceiptFromTools, resolveWebApproval, pendingWebLookupPrompt, shouldSendScreenshot, settingsWithModelBudget, pruneChatForRegeneration, sanitizeReferenceImages, toolDefinitionsForPolicy, toolDefinitionsForTurn, toolNamesForTurn, isPrivateIp, modelCapabilityStatus, applyModelAdapter, normalizeLoopbackHttpUrl, assertRequiredBlenderOverview, contextForModelVision, referenceImageDescriptors, visualEvidenceDescriptors, samplingProfileForTurn, compactChatToSummary, detectAuthoritativeModeContradiction, normalizedLmUsage, mergeLmUsage, persistedLmUsage };\n";

const sandbox = {
  require,
  module: { exports: {} },
  exports: {},
  console,
  process,
  Buffer,
  setTimeout,
  clearTimeout,
  AbortController,
  URL,
  fetch,
};

vm.runInNewContext(backendSource, sandbox, { filename: backendPath });

const {
  writePromptPacket,
  cleanModelText,
  buildChatPayload,
  estimateContextUsage,
  contextToSnapshot,
  runLmStudioCompletionWithTools,
  assistantContextLine,
  assistantReceipt,
  assistantReceiptFromTools,
  resolveWebApproval,
  pendingWebLookupPrompt,
  shouldSendScreenshot,
  settingsWithModelBudget,
  pruneChatForRegeneration,
  sanitizeReferenceImages,
  toolDefinitionsForPolicy,
  toolDefinitionsForTurn,
  toolNamesForTurn,
  isPrivateIp,
  modelCapabilityStatus,
  applyModelAdapter,
  normalizeLoopbackHttpUrl,
  assertRequiredBlenderOverview,
  contextForModelVision,
  referenceImageDescriptors,
  visualEvidenceDescriptors,
  samplingProfileForTurn,
  compactChatToSummary,
  detectAuthoritativeModeContradiction,
  normalizedLmUsage,
  mergeLmUsage,
  persistedLmUsage,
} = sandbox.module.exports.__test__;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "blendy-packet-"));
const packetPath = path.join(tempDir, "prompt-packet.json");
const validPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const overviewDataUrl = "data:image/png;base64,b3ZlcnZpZXc=";
const focusedDataUrl = "data:image/png;base64,Zm9jdXNlZA==";
const routerTrace = {
  selectedRoute: "troubleshooting",
  score: 88,
  troubleshootingCards: [{ id: "trouble_bevel_modifier_appears_to_do_nothing" }],
};

const liveContext = {
  ok: true,
  modelVision: true,
  capturedOverview: true,
  bridge: { blenderVersion: "5.0.1" },
  selected: { object: "RadioBody", mode: "Object", units: "Metric", scale: "1, 1, 1" },
  runtimeState: {
    blenderVersion: "5.0.1",
    mode: "OBJECT",
    workspace: "Layout",
    activeObject: "RadioBody",
    activeObjectType: "MESH",
    selectedObjects: ["RadioBody"],
    activeTool: "Active tool: builtin.select_box",
    meshSelectionMode: [],
    snapEnabled: false,
    snapElements: [],
    proportionalEditing: false,
    pivotPoint: "MEDIAN_POINT",
    transformOrientation: "GLOBAL",
    viewport: { shading: "SOLID", overlays: true, xray: false, localView: false },
    frame: 1,
  },
  contextLine: "Used: Blender 5.0.1 | RadioBody selected | Object | Blender screen captured",
  visual: "Captured: Full active Blender window, Focused View 3D evidence.",
  used: {
    screenshot: true,
    screenshotCaptured: true,
    screenshotDelivered: true,
    screenshotOverview: true,
    knowledgeMode: "LOCAL_ONLY",
  },
  visualEvidence: [
    { kind: "active_editor", label: "Focused View 3D evidence", editorType: "VIEW_3D", dataUrl: focusedDataUrl },
    { kind: "overview", label: "Full active Blender window", editorType: "SCREEN", dataUrl: overviewDataUrl },
  ],
  promptParts: {
    runtime_facts: "Blender version: 5.0.1\nCurrent mode: OBJECT",
    scene_context: "Selected object: RadioBody\nScale: 1, 1, 1",
    scene_diff: "No prior snapshot",
    knowledge_status: {},
    router_trace: {},
  },
};

assert.doesNotThrow(() => assertRequiredBlenderOverview(liveContext));
assert.throws(
  () => assertRequiredBlenderOverview({ ...liveContext, visualEvidence: [liveContext.visualEvidence[0]] }),
  /required full Blender window/,
);
assert.strictEqual(visualEvidenceDescriptors(liveContext)[0].kind, "overview");

writePromptPacket(packetPath, {
  prompt: "I added bevel but it still looks sharp",
  context: {
    ...liveContext,
    promptParts: {
      router_trace: routerTrace,
      knowledge_status: { selectedCards: ["Bevel Modifier Appears to Do Nothing"] },
      knowledge_sources: [],
    },
  },
  actualUsage: { promptTokens: 900, completionTokens: 31, totalTokens: 931, reported: true },
  completionDiagnostics: { finishReason: "stop" },
  payload: {
    model: "gemma-test",
    temperature: 0.35,
    max_tokens: 3200,
    stream: true,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: overviewDataUrl } },
          { type: "text", text: "Image 1 above is the full live Blender window." },
        ],
      },
    ],
  },
});

const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
const packetText = JSON.stringify(packet);
assert.deepStrictEqual(packet.routerTrace, routerTrace);
assert.deepStrictEqual(packet.selectedCards, ["Bevel Modifier Appears to Do Nothing"]);
assert.strictEqual(packet.actualUsage.totalTokens, 931);
assert.strictEqual(packet.completionDiagnostics.finishReason, "stop");
assert(packetText.includes("[omitted Blender screen screenshot data]"));
assert(!packetText.includes(overviewDataUrl));
assert(!packetText.includes("data:image/png;base64"));

const cleaned = cleanModelText(
  "### Method 1: The *Curve* Way\n\n1. Charger Body $\\rightarrow$ Cable\n\n**Next step:**",
);
assert(!cleaned.includes("###"));
assert(!cleaned.includes("*Curve*"));
assert(!cleaned.includes("$\\rightarrow$"));
assert(cleaned.includes("Method 1: The Curve Way"));
assert(cleaned.includes("Charger Body -> Cable"));

const bridgedChat = {
  compactedSummary: "Remember that the user named the small part a connector.",
  compactedMessageCount: 0,
  projectNotebook: "This is a small sci-fi charger prop.",
  goalAnchor: "Build a compact sci-fi charger.",
  messages: [
    { role: "assistant", content: "Earlier answer.", status: "done" },
    { role: "user", content: "Where should this attach?" },
  ],
};
const ordinaryPayload = buildChatPayload({
  prompt: "Where should this attach?",
  context: liveContext,
  chat: bridgedChat,
  settings: {
    model: "gemma-test",
    responseMaxTokens: 3200,
    userInstructions: "I am a beginner and I have made simple beveled product shapes before.",
    toolUse: "AUTO",
    knowledgeMode: "LOCAL_AUTO_WEB",
  },
});

assert(!ordinaryPayload.messages[0].content.includes("PYTHON SYSTEM PROMPT"));
assert(ordinaryPayload.messages[0].content.includes("local, read-only Blender tutor"));
assert(ordinaryPayload.messages[0].content.includes("AUTHORITATIVE BLENDER STATE is machine-read truth"));
assert(ordinaryPayload.messages[0].content.includes("FULL BLENDER WINDOW image is visual truth"));
const ordinaryText = ordinaryPayload.messages.at(-1).content.at(-1).text;
assert(ordinaryText.includes("VISUAL EVIDENCE MAP"));
assert(ordinaryText.includes("Image 1: FULL LIVE BLENDER WINDOW"));
assert(ordinaryText.includes("AUTHORITATIVE BLENDER STATE"));
assert(ordinaryText.includes("CURRENT TASK - ANSWER THIS NOW"));
assert(ordinaryText.includes("I am a beginner"));
assert(ordinaryText.includes("Remember that the user named the small part a connector."));
assert(ordinaryText.includes("small sci-fi charger prop"));
assert.strictEqual(
  ordinaryPayload.messages.filter((message) => message.role === "user" && message.content === "Where should this attach?").length,
  0,
);
assert(!Object.prototype.hasOwnProperty.call(ordinaryPayload, "tools"));
assert(!Object.prototype.hasOwnProperty.call(ordinaryPayload, "tool_choice"));
assert.strictEqual(ordinaryPayload.temperature, 0.55);
assert.strictEqual(ordinaryPayload.top_p, 0.92);
assert.strictEqual(ordinaryPayload.top_k, 48);

const docsPayload = buildChatPayload({
  prompt: "Check the official Blender documentation for the Bevel modifier.",
  context: liveContext,
  chat: { compactedSummary: "", compactedMessageCount: 0, projectNotebook: "", goalAnchor: "", messages: [] },
  settings: { model: "gemma-test", responseMaxTokens: 3200, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
});
assert.deepStrictEqual(Array.from(docsPayload.tools, (tool) => tool.function.name), ["search_blender_docs"]);
assert.strictEqual(docsPayload.tool_choice, "auto");
assert.strictEqual(docsPayload.temperature, 0.35);

const workflowPayload = buildChatPayload({
  prompt: "Is there a better workflow than doing this manually one by one?",
  context: liveContext,
  chat: { compactedSummary: "", compactedMessageCount: 0, projectNotebook: "", goalAnchor: "", messages: [] },
  settings: { model: "gemma-test", responseMaxTokens: 3200, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
});
assert.deepStrictEqual(Array.from(workflowPayload.tools, (tool) => tool.function.name), ["search_workflow_notes"]);
assert.deepStrictEqual(Array.from(toolNamesForTurn("Where should this attach?", liveContext, { toolUse: "AUTO" }, false)), []);

const namedReference = { dataUrl: validPngDataUrl, name: "Flash grenade target.png" };
const multimodalContext = { ...liveContext, referenceImages: [namedReference] };
const multimodalPayload = buildChatPayload({
  prompt: "Compare my current scene with this reference.",
  context: multimodalContext,
  chat: { compactedSummary: "", compactedMessageCount: 0, projectNotebook: "", goalAnchor: "", messages: [] },
  settings: { model: "gemma-test", responseMaxTokens: 3200, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
});
const multimodalContent = multimodalPayload.messages.at(-1).content;
assert(Array.isArray(multimodalContent));
assert.strictEqual(multimodalContent[0].image_url.url, overviewDataUrl, "The full Blender overview must be the first image.");
assert(multimodalContent[1].text.includes("full live Blender window"));
assert.strictEqual(multimodalContent[2].image_url.url, focusedDataUrl);
assert(multimodalContent[3].text.includes("focused live VIEW_3D crop"));
assert.strictEqual(multimodalContent[4].image_url.url, validPngDataUrl);
assert(multimodalContent[5].text.includes('user reference target named "Flash grenade target.png"'));
assert(multimodalContent.at(-1).text.includes('USER REFERENCE TARGET named "Flash grenade target.png"'));
assert.strictEqual(referenceImageDescriptors(multimodalContext)[0].name, "Flash grenade target.png");

const creativePayload = buildChatPayload({
  prompt: "Brainstorm three stylized design variations for this prop.",
  context: liveContext,
  chat: { compactedSummary: "", compactedMessageCount: 0, projectNotebook: "", goalAnchor: "", messages: [] },
  settings: { model: "gemma-test", responseMaxTokens: 3200, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
});
assert.strictEqual(creativePayload.temperature, 0.75);
assert.strictEqual(creativePayload.top_p, 0.95);
assert.strictEqual(creativePayload.top_k, 64);
assert.strictEqual(samplingProfileForTurn("Why is this modifier not working?").profile, "exact");

const toolOffPayload = buildChatPayload({
  prompt: "Check the official docs for this modifier.",
  context: liveContext,
  chat: bridgedChat,
  settings: { model: "gemma-test", responseMaxTokens: 3200, toolUse: "OFF", knowledgeMode: "LOCAL_ONLY" },
});
assert(!Object.prototype.hasOwnProperty.call(toolOffPayload, "tools"));

const ordinaryUsage = estimateContextUsage({
  prompt: "Where should this attach?",
  context: multimodalContext,
  chat: bridgedChat,
  settings: { contextLimitTokens: 70000, responseMaxTokens: 3200, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
});
assert(ordinaryUsage.toolDefinitionTokens <= 1, "An ordinary turn may account for the serialized empty tool list, but offers no tool schema.");
assert.strictEqual(ordinaryUsage.toolReserveTokens, 0);
assert.strictEqual(ordinaryUsage.imageCount, 3);
assert(ordinaryUsage.imageReserveTokens >= 2700);
assert(ordinaryUsage.availableForConversationTokens > 0);

const docsUsage = estimateContextUsage({
  prompt: "Check the official Blender documentation for this modifier.",
  context: liveContext,
  chat: bridgedChat,
  settings: { contextLimitTokens: 70000, responseMaxTokens: 3200, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
});
assert(docsUsage.toolDefinitionTokens > 0);
assert(docsUsage.toolReserveTokens > 0);

const legacyBudget = settingsWithModelBudget(
  { responseMaxTokens: 2200, contextLimitTokens: 70000, knowledgeMode: "ASK_BEFORE_WEB" },
  { contextLength: 4096 },
);
assert.strictEqual(legacyBudget.responseMaxTokens, 2200);
assert.strictEqual(legacyBudget.contextLimitTokens, 1896);
assert.strictEqual(legacyBudget.configuredContextLimitTokens, 70000);
assert.strictEqual(legacyBudget.modelContextLength, 4096);
const budgetUsage = estimateContextUsage({
  prompt: "Where should this attach?",
  context: liveContext,
  chat: { ...bridgedChat, lastUsage: { promptTokens: 900, completionTokens: 31, totalTokens: 931, reported: true, measuredAt: "now", requestCount: 1 } },
  settings: legacyBudget,
});
const budgetSnapshot = contextToSnapshot(liveContext, tempDir, budgetUsage);
assert.strictEqual(budgetSnapshot.effectiveInputLimitTokens, budgetSnapshot.contextLimitTokens);
assert.strictEqual(budgetSnapshot.configuredLimitTokens, budgetSnapshot.configuredContextLimitTokens);
assert.strictEqual(budgetSnapshot.modelContextTokens, budgetSnapshot.modelContextLength);
assert.strictEqual(budgetSnapshot.answerReserveTokens, budgetSnapshot.responseReserveTokens);
assert.strictEqual(budgetSnapshot.currentRequestTokens, budgetSnapshot.contextTokens);
assert.strictEqual(budgetSnapshot.lastActualTotalTokens, 931);

const visionReceipt = assistantReceipt(multimodalContext);
assert.strictEqual(visionReceipt.details.usedScreenshot, true);
assert.strictEqual(visionReceipt.details.referenceImageCount, 1);
assert.strictEqual(visionReceipt.details.referenceNames[0], "Flash grenade target.png");
const textOnlyContext = contextForModelVision(multimodalContext, { vision: false });
const textOnlyReceipt = assistantReceiptFromTools(textOnlyContext, []);
assert.strictEqual(textOnlyContext.used.screenshotCaptured, true);
assert.strictEqual(textOnlyContext.used.screenshotDelivered, false);
assert.strictEqual(textOnlyReceipt.details.usedScreenshot, false);
assert.strictEqual(textOnlyReceipt.details.referenceImageCount, 0);
assert.strictEqual(textOnlyReceipt.details.referenceNames.length, 0);

assert.strictEqual(shouldSendScreenshot("Explain modifiers", "auto"), true);
assert.strictEqual(shouldSendScreenshot("", "auto"), false);
assert.strictEqual(shouldSendScreenshot("", "always"), true);

const webPermissionMessages = [
  { role: "user", content: "What is the newest Blender release available today?" },
  { role: "assistant", content: "Would you like me to perform a web search?" },
];
assert.strictEqual(pendingWebLookupPrompt(webPermissionMessages), "What is the newest Blender release available today?");
assert.strictEqual(resolveWebApproval("yes", webPermissionMessages).webApproved, true);
assert.strictEqual(resolveWebApproval("you can web search", webPermissionMessages).webApproved, true);
assert(toolDefinitionsForPolicy({ toolUse: "AUTO", knowledgeMode: "ASK_BEFORE_WEB" }, false).every(
  (tool) => !["web_search", "fetch_url"].includes(tool.function.name),
));
assert(toolDefinitionsForTurn(
  { toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
  false,
  "Check official Blender docs for this modifier",
  liveContext,
).some((tool) => tool.function.name === "search_blender_docs"));

const regenerationChat = {
  compactedMessageCount: 1,
  messages: [
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer", status: "done" },
    { role: "user", content: "Latest question" },
    { role: "assistant", content: "Old answer that must not be fed back", status: "done" },
  ],
};
const regenerated = pruneChatForRegeneration(regenerationChat);
assert.strictEqual(regenerated.lastUser.content, "Latest question");
assert.strictEqual(regenerationChat.messages.length, 3);
assert.strictEqual(regenerationChat.compactedMessageCount, 1);
assert(!JSON.stringify(regenerationChat).includes("Old answer that must not be fed back"));

const sanitizedReferences = sanitizeReferenceImages([{ dataUrl: validPngDataUrl, name: "  Flash Grenade\u0000 Target.png  " }]);
assert.strictEqual(sanitizedReferences.length, 1);
assert.strictEqual(sanitizedReferences[0].name, "Flash Grenade Target.png");
assert.strictEqual(sanitizedReferences[0].dataUrl, validPngDataUrl);
assert.throws(() => sanitizeReferenceImages(["data:image/png;base64,c21hbGw="]), /could not be decoded as a valid/);
assert.throws(() => sanitizeReferenceImages(["data:text/plain;base64,bm8="]), /PNG, JPEG, or WebP/);

assert.strictEqual(isPrivateIp("127.0.0.1"), true);
assert.strictEqual(isPrivateIp("192.168.1.5"), true);
assert.strictEqual(isPrivateIp("8.8.8.8"), false);
assert.strictEqual(normalizeLoopbackHttpUrl("https://evil.example/v1", "http://localhost:1234/v1"), "http://localhost:1234/v1");
assert.strictEqual(normalizeLoopbackHttpUrl("http://127.0.0.1:1234/v1", "http://localhost:1234/v1"), "http://127.0.0.1:1234/v1");

const preferredStatus = modelCapabilityStatus("google/gemma-4-test", {
  architecture: "gemma4",
  capabilities: { vision: true, trained_for_tool_use: true },
  loaded_instances: [{ id: "preferred-instance", config: { context_length: 32768 } }],
}, true);
const legacyStatus = modelCapabilityStatus("google/gemma-4-test", {
  architecture: "gemma4",
  capabilities: { vision: true, trained_for_tool_use: true },
  loadedInstances: [{ id: "legacy-instance", config: { contextLength: 16384 } }],
}, true);
assert.strictEqual(preferredStatus.contextLength, 32768);
assert.strictEqual(legacyStatus.contextLength, 16384);
assert.strictEqual(preferredStatus.vision, true);
assert.strictEqual(preferredStatus.toolUse, true);

const adaptedTutoringPayload = applyModelAdapter(
  { model: preferredStatus.modelId, temperature: ordinaryPayload.temperature, top_p: ordinaryPayload.top_p, top_k: ordinaryPayload.top_k },
  { temperature: null, topP: null, topK: null },
  preferredStatus,
);
assert.strictEqual(adaptedTutoringPayload.temperature, 0.55);
assert.strictEqual(adaptedTutoringPayload.top_p, 0.92);
assert.strictEqual(adaptedTutoringPayload.top_k, 48);
const explicitSampling = applyModelAdapter(
  { model: preferredStatus.modelId, temperature: 0.55, top_p: 0.92, top_k: 48 },
  { temperature: 0.3, topP: 0.8, topK: 32 },
  preferredStatus,
);
assert.strictEqual(explicitSampling.temperature, 0.3);
assert.strictEqual(explicitSampling.top_p, 0.8);
assert.strictEqual(explicitSampling.top_k, 32);

const wrongMode = detectAuthoritativeModeContradiction("You're in Edit Mode, so select the front face.", liveContext);
assert(wrongMode);
assert.strictEqual(wrongMode.authoritativeMode, "OBJECT");
assert.strictEqual(wrongMode.claims[0].claimedMode, "EDIT");
assert.strictEqual(detectAuthoritativeModeContradiction("Press Tab to enter Edit Mode, then select the front face.", liveContext), null);
assert.strictEqual(detectAuthoritativeModeContradiction("Enter Edit Mode and select the front face.", liveContext), null);
assert.strictEqual(detectAuthoritativeModeContradiction("You are already in Object Mode.", liveContext), null);

const normalizedUsage = normalizedLmUsage({ input_tokens: 100, output_tokens: 20 });
assert.strictEqual(normalizedUsage.promptTokens, 100);
assert.strictEqual(normalizedUsage.completionTokens, 20);
assert.strictEqual(normalizedUsage.totalTokens, 120);
const mergedUsage = mergeLmUsage(normalizedUsage, { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 });
assert.strictEqual(mergedUsage.totalTokens, 180);
assert.strictEqual(mergedUsage.requestCount, 2);
const savedUsage = persistedLmUsage(mergedUsage, { scope: "reported-calls-only" });
assert.strictEqual(savedUsage.reported, true);
assert.strictEqual(savedUsage.totalTokens, 180);

function jsonResponse(data) {
  const body = JSON.stringify(data);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => body,
    json: async () => data,
    headers: { get: () => "application/json" },
  };
}

function modelDiscoveryResponse(url) {
  if (String(url).endsWith("/api/v1/models")) {
    return jsonResponse({
      models: [{
        key: "tool-model",
        display_name: "Tool Model",
        architecture: "gemma4",
        type: "llm",
        capabilities: { vision: true, trained_for_tool_use: true },
        loaded_instances: [{ id: "tool-model:fixture", config: { context_length: 32768 } }],
      }],
    });
  }
  if (String(url).endsWith("/models")) {
    return jsonResponse({ data: [{ id: "tool-model", object: "model" }] });
  }
  return null;
}

async function testOrdinaryTutorPromptSkipsToolPlanning() {
  const chatRequests = [];
  sandbox.fetch = async (url, options = {}) => {
    const discovery = modelDiscoveryResponse(url);
    if (discovery) return discovery;
    const body = JSON.parse(options.body || "{}");
    chatRequests.push(body);
    return jsonResponse({
      choices: [{ message: { role: "assistant", content: "Refine the existing connector, then check its contact with the body." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
    });
  };

  let streamed = "";
  const completion = await runLmStudioCompletionWithTools({
    settings: {
      lmStudioBaseUrl: "http://localhost:1234/v1",
      model: "auto",
      responseMaxTokens: 3200,
      contextLimitTokens: 70000,
      toolUse: "AUTO",
      knowledgeMode: "LOCAL_ONLY",
    },
    payload: buildChatPayload({
      prompt: "Where should this attach?",
      context: liveContext,
      chat: { compactedSummary: "", compactedMessageCount: 0, projectNotebook: "", goalAnchor: "", messages: [] },
      settings: { model: "auto", responseMaxTokens: 3200, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
    }),
    prompt: "Where should this attach?",
    context: liveContext,
    chat: { compactedSummary: "", compactedMessageCount: 0, projectNotebook: "", goalAnchor: "", messages: [] },
    onDelta(delta) { streamed += delta; },
  });

  assert.strictEqual(chatRequests.length, 1);
  assert(!Object.prototype.hasOwnProperty.call(chatRequests[0], "tools"));
  assert(completion.text.includes("connector"));
  assert.strictEqual(completion.toolTrace.length, 0);
  assert.strictEqual(completion.usage.totalTokens, 50);
  assert(streamed.includes("connector"));
}

async function testExplicitDocsPromptCanUseToolPlanning() {
  const chatRequests = [];
  sandbox.fetch = async (url, options = {}) => {
    const discovery = modelDiscoveryResponse(url);
    if (discovery) return discovery;
    const body = JSON.parse(options.body || "{}");
    chatRequests.push(body);
    const planningNumber = chatRequests.filter((request) => Array.isArray(request.tools)).length;
    if (Array.isArray(body.tools) && planningNumber === 1) {
      return jsonResponse({
        choices: [{
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "search_blender_docs", arguments: JSON.stringify({ query: "bevel modifier" }) },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      });
    }
    if (Array.isArray(body.tools)) {
      return jsonResponse({
        choices: [{ message: { role: "assistant", content: "NO_TOOL" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      });
    }
    return jsonResponse({
      choices: [{ message: { role: "assistant", content: "Use the Bevel modifier, then verify its Amount against the scene scale." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    });
  };

  const prompt = "Check the official Blender documentation for the Bevel modifier.";
  const completion = await runLmStudioCompletionWithTools({
    settings: {
      lmStudioBaseUrl: "http://localhost:1234/v1",
      model: "auto",
      responseMaxTokens: 3200,
      contextLimitTokens: 70000,
      toolUse: "AUTO",
      knowledgeMode: "LOCAL_ONLY",
    },
    payload: buildChatPayload({
      prompt,
      context: liveContext,
      chat: { compactedSummary: "", compactedMessageCount: 0, projectNotebook: "", goalAnchor: "", messages: [] },
      settings: { model: "auto", responseMaxTokens: 3200, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
    }),
    prompt,
    context: liveContext,
    chat: { compactedSummary: "", compactedMessageCount: 0, projectNotebook: "", goalAnchor: "", messages: [] },
    onDelta() {},
  });

  assert.strictEqual(chatRequests.length, 3);
  assert.deepStrictEqual(Array.from(chatRequests[0].tools, (tool) => tool.function.name), ["search_blender_docs"]);
  assert.strictEqual(chatRequests[0].tool_choice, "auto");
  assert.strictEqual(chatRequests[0].max_tokens, 500);
  assert(chatRequests[1].messages.some((message) => message.role === "tool" && message.name === "search_blender_docs"));
  assert(!Object.prototype.hasOwnProperty.call(chatRequests[2], "tools"));
  assert.strictEqual(completion.toolTrace[0].call.name, "search_blender_docs");
  assert.strictEqual(completion.usage.promptTokens, 115);
  assert.strictEqual(completion.usage.completionTokens, 23);
  assert.strictEqual(completion.usage.totalTokens, 138);
  assert.strictEqual(completion.usage.requestCount, 3);
}

async function testCompactionKeepsFullVisibleChat() {
  sandbox.fetch = async (url, options = {}) => {
    const discovery = modelDiscoveryResponse(url);
    if (discovery) return discovery;
    const body = JSON.parse(options.body || "{}");
    assert.strictEqual(body.stream, false);
    return jsonResponse({
      choices: [{ message: { role: "assistant", content: "User is building a radio and confirmed rounded corners." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 15, total_tokens: 135 },
    });
  };

  const messages = [];
  for (let index = 0; index < 6; index += 1) {
    messages.push({ id: `u${index}`, role: "user", content: `User turn ${index}` });
    messages.push({ id: `a${index}`, role: "assistant", content: `Assistant turn ${index}`, status: "done" });
  }
  const chat = {
    messages,
    compactedSummary: "",
    compactedMessageCount: 0,
    projectNotebook: "",
    goalAnchor: "Build a radio",
  };
  const original = JSON.stringify(chat);
  const compacted = await compactChatToSummary({
    chat,
    settings: {
      lmStudioBaseUrl: "http://localhost:1234/v1",
      model: "auto",
      responseMaxTokens: 3200,
      contextLimitTokens: 70000,
      toolUse: "OFF",
      knowledgeMode: "LOCAL_ONLY",
    },
  });

  assert.strictEqual(JSON.stringify(chat), original, "Compaction must not delete or mutate the visible source chat.");
  assert.strictEqual(compacted.messages.length, messages.length + 1);
  assert.strictEqual(JSON.stringify(compacted.messages.slice(0, messages.length)), JSON.stringify(messages));
  assert.strictEqual(compacted.messages.at(-1).marker, "compacted");
  assert.strictEqual(compacted.compactedMessageCount, 4);
  assert(compacted.compactedSummary.includes("rounded corners"));
}

Promise.resolve()
  .then(testOrdinaryTutorPromptSkipsToolPlanning)
  .then(testExplicitDocsPromptCanUseToolPlanning)
  .then(testCompactionKeepsFullVisibleChat)
  .then(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log("Prompt packet diagnostic test passed.");
  })
  .catch((error) => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.error(error);
    process.exit(1);
  });