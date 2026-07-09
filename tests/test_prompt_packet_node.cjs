const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const backendPath = path.join(repoRoot, "blendy", "electron", "backend.cjs");
const backendSource =
  fs.readFileSync(backendPath, "utf8") +
  "\nmodule.exports.__test__ = { writePromptPacket, sanitizePromptPacketMessages, cleanModelText, buildChatPayload, buildContextText, estimateContextUsage, runLmStudioCompletionWithTools, assistantContextLine, assistantReceipt, resolveWebApproval, pendingWebLookupPrompt, shouldSendScreenshot, settingsWithModelBudget, pruneChatForRegeneration, sanitizeReferenceImages, toolDefinitionsForPolicy, isPrivateIp, modelCapabilityStatus, applyModelAdapter, normalizeLoopbackHttpUrl };\n";

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
  buildContextText,
  estimateContextUsage,
  runLmStudioCompletionWithTools,
  assistantContextLine,
  assistantReceipt,
  resolveWebApproval,
  pendingWebLookupPrompt,
  shouldSendScreenshot,
  settingsWithModelBudget,
  pruneChatForRegeneration,
  sanitizeReferenceImages,
  toolDefinitionsForPolicy,
  isPrivateIp,
  modelCapabilityStatus,
  applyModelAdapter,
  normalizeLoopbackHttpUrl,
} = sandbox.module.exports.__test__;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "blendy-packet-"));
const packetPath = path.join(tempDir, "prompt-packet.json");
const routerTrace = {
  selectedRoute: "troubleshooting",
  score: 88,
  troubleshootingCards: [{ id: "trouble_bevel_modifier_appears_to_do_nothing" }],
};

writePromptPacket(packetPath, {
  prompt: "I added bevel but it still looks sharp",
  context: {
    contextLine: "Used: Blender 5.0.1 | Cube selected",
    promptParts: {
      router_trace: routerTrace,
      knowledge_status: {
        selectedCards: ["Bevel Modifier Appears to Do Nothing"],
      },
      knowledge_sources: [],
    },
  },
  payload: {
    model: "gemma-test",
    temperature: 0.4,
    max_tokens: 8000,
    stream: true,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "TOOL USE\nRead-only tools are available." },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,SCREENSHOT_SHOULD_NOT_BE_WRITTEN" },
          },
        ],
      },
    ],
  },
});

const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
const packetText = JSON.stringify(packet);

assert.deepStrictEqual(packet.routerTrace, routerTrace);
assert.deepStrictEqual(packet.selectedCards, ["Bevel Modifier Appears to Do Nothing"]);
assert(!Object.prototype.hasOwnProperty.call(packet, "tutorStyle"));
assert(packetText.includes("TOOL USE"));
assert.deepStrictEqual(packet.toolsOffered, []);
assert(!packetText.includes("Selected route: troubleshooting"));
assert(packetText.includes("[omitted Blender screen screenshot data]"));
assert(!packetText.includes("SCREENSHOT_SHOULD_NOT_BE_WRITTEN"));
assert(!packetText.includes("data:image/png;base64"));

const cleaned = cleanModelText(
  "### Method 1: The *Curve* Way\n\n1. Charger Body $\\rightarrow$ Cable\n\n**Next step:**"
);

assert(!cleaned.includes("###"));
assert(!cleaned.includes("*Curve*"));
assert(!cleaned.includes("$\\rightarrow$"));
assert(cleaned.includes("Method 1: The Curve Way"));
assert(cleaned.includes("Charger Body -> Cable"));

const bridgedContext = {
  promptParts: {
    system_prompt: "PYTHON SYSTEM PROMPT",
    context_text: "USER PROMPT\nBridge-built context\n\nCOMPACTED SESSION SUMMARY\n[no compacted session summary]",
  },
  screenshotDataUrl: "",
};
const bridgedChat = {
  compactedSummary: "Remember that the user named the small part a connector.",
  projectNotebook: "This is a small sci-fi charger prop.",
  messages: [
    { role: "assistant", content: "Earlier answer." },
    { role: "user", content: "Where should this attach?" },
  ],
};
const bridgedPayload = buildChatPayload({
  prompt: "Where should this attach?",
  context: bridgedContext,
  chat: bridgedChat,
  settings: {
    model: "gemma-test",
    responseMaxTokens: 8000,
    userInstructions: "I am a beginner and I have made simple beveled product shapes before.",
    knowledgeMode: "LOCAL_AUTO_WEB",
  },
});

assert(!bridgedPayload.messages[0].content.includes("PYTHON SYSTEM PROMPT"));
assert(bridgedPayload.messages[0].content.includes("You are Blendy"));
assert(bridgedPayload.messages[0].content.includes("untrusted data evidence"));
assert(!bridgedPayload.messages.at(-1).content.includes("Bridge-built context"));
assert(bridgedPayload.messages.at(-1).content.includes("TOOL USE"));
assert(bridgedPayload.messages.at(-1).content.includes("USER INSTRUCTIONS"));
assert(bridgedPayload.messages.at(-1).content.includes("I am a beginner"));
assert(bridgedPayload.messages.at(-1).content.includes("Remember that the user named the small part a connector."));
assert(bridgedPayload.messages.at(-1).content.includes("small sci-fi charger prop"));
assert.strictEqual(
  bridgedPayload.messages.filter((message) => message.role === "user" && message.content === "Where should this attach?").length,
  0,
);
assert(Array.isArray(bridgedPayload.tools));
assert(bridgedPayload.tools.some((tool) => tool.function.name === "web_search"));
assert(bridgedPayload.tools.find((tool) => tool.function.name === "web_search").function.description.includes("visual effect examples"));
assert.strictEqual(bridgedPayload.tool_choice, "auto");
assert.strictEqual(bridgedPayload.max_tokens, 6000);

const multimodalPayload = buildChatPayload({
  prompt: "Compare this reference with my scene",
  context: {
    promptParts: {},
    screenshotDataUrl: "data:image/png;base64,c2NyZWVu",
    referenceImages: ["data:image/png;base64,cmVm"],
  },
  chat: { compactedSummary: "", projectNotebook: "", messages: [] },
  settings: { model: "gemma-test", responseMaxTokens: 2200, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
});
assert(Array.isArray(multimodalPayload.messages.at(-1).content));
assert.strictEqual(multimodalPayload.messages.at(-1).content[0].type, "image_url");
assert.strictEqual(multimodalPayload.messages.at(-1).content.at(-1).type, "text");
assert(!multimodalPayload.tools.some((tool) => ["web_search", "fetch_url"].includes(tool.function.name)));

const nativePromptPayload = buildChatPayload({
  prompt: "How do I make this look like a blood splash?",
  context: { ...bridgedContext, promptParts: {} },
  chat: { compactedSummary: "", messages: [] },
  settings: { model: "gemma-test", responseMaxTokens: 2200, toolUse: "AUTO" },
});
assert(nativePromptPayload.messages[0].content.includes("Make a fast choice"));

const toolOffPayload = buildChatPayload({
  prompt: "Where should this attach?",
  context: bridgedContext,
  chat: bridgedChat,
  settings: { model: "gemma-test", responseMaxTokens: 8000, toolUse: "OFF" },
});
assert(!Object.prototype.hasOwnProperty.call(toolOffPayload, "tools"));
assert(!Object.prototype.hasOwnProperty.call(toolOffPayload, "tool_choice"));

const usageWithToolsAndScreenshot = estimateContextUsage({
  prompt: "Look at this",
  context: { ...bridgedContext, screenshotDataUrl: "data:image/png;base64,abc" },
  chat: bridgedChat,
  settings: { contextLimitTokens: 70000, toolUse: "AUTO" },
});
assert(usageWithToolsAndScreenshot.toolDefinitionTokens > 0);
assert(usageWithToolsAndScreenshot.toolReserveTokens > 0);
assert(usageWithToolsAndScreenshot.imageReserveTokens > 0);
assert(usageWithToolsAndScreenshot.availableForConversationTokens > 0);

const usageWithOmittedScreenshotBytes = estimateContextUsage({
  prompt: "take a look",
  context: {
    ...bridgedContext,
    ok: true,
    screenshotDataUrl: "",
    used: { screenshot: true },
    visual: "Blender screen captured",
  },
  chat: bridgedChat,
  settings: { contextLimitTokens: 70000, toolUse: "AUTO" },
});
assert(usageWithOmittedScreenshotBytes.imageReserveTokens > 0);

const usageForNextVisualPrompt = estimateContextUsage({
  prompt: "",
  context: {
    ...bridgedContext,
    ok: true,
    screenshotDataUrl: "",
    used: { screenshot: false },
    visual: "Viewport status available",
  },
  chat: bridgedChat,
  settings: { contextLimitTokens: 70000, toolUse: "AUTO" },
});
assert(usageForNextVisualPrompt.imageReserveTokens > 0);

const usageWithoutBridgeVisual = estimateContextUsage({
  prompt: "",
  context: {
    ...bridgedContext,
    ok: false,
    screenshotDataUrl: "",
    used: { screenshot: false },
    visual: "Blender screen not captured",
  },
  chat: bridgedChat,
  settings: { contextLimitTokens: 70000, toolUse: "AUTO" },
});
assert.strictEqual(usageWithoutBridgeVisual.imageReserveTokens, 0);
assert.strictEqual(shouldSendScreenshot("Explain modifiers", "auto"), true);
assert.strictEqual(shouldSendScreenshot("ive done everything you said, its not working", "auto"), true);
assert.strictEqual(shouldSendScreenshot("", "auto"), false);

const receiptLine = assistantContextLine({
  used: { screenshot: true },
  promptParts: {
    knowledge_status: {
      selectedRoute: "troubleshooting",
      lastWebLookupStatus: "Web lookup used 1 official source(s).",
      reliedOn: "live scene + local official docs + broad web results + model memory fallback",
      selectedCards: ["Bevel Modifier Appears to Do Nothing", "Apply Scale Before Judging Modifiers"],
      sourceUrls: ["https://example.com/source"],
    },
    router_trace: {
      workflowCards: [{ title: "Use curve bevel depth for cords" }],
      troubleshootingCards: [{ title: "Bevel appears unchanged" }],
    },
  },
});
assert(receiptLine.includes("Troubleshooting"));
assert(receiptLine.includes("Workflow Shortcut"));
assert(receiptLine.includes("Web Search"));
assert(receiptLine.includes("Blender Docs"));
assert(!receiptLine.includes("Implementation"));
assert(!receiptLine.includes("Invoked Web Search"));
assert(!receiptLine.includes("Local Blender Docs"));
assert(!receiptLine.includes("Viewport inspected"));
assert(!receiptLine.includes("Bevel Modifier Appears to Do Nothing"));

const receipt = assistantReceipt({
  promptParts: {
    knowledge_status: {
      selectedRoute: "troubleshooting",
      lastWebLookupStatus: "Web lookup used 1 official source(s).",
      selectedCards: ["Bevel Modifier Appears to Do Nothing"],
      webSearchQueries: ["bevel modifier does nothing"],
      webSearchUsedQueries: ["bevel modifier does nothing"],
      sourceUrls: ["https://example.com/source"],
    },
    router_trace: {
      troubleshootingCards: [
        {
          id: "trouble_bevel",
          title: "Bevel Modifier Appears to Do Nothing",
          type: "troubleshooting",
          score: 88,
          destructiveRisk: "low",
          reasons: ["Expected-result mismatch matched troubleshooting cards."],
          betterMove: "Check scale before judging the bevel.",
          sources: [
            {
              title: "Bevel Manual",
              url: "https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/bevel.html",
              sourceType: "official",
              quality: "official",
            },
          ],
        },
      ],
      workflowCards: [],
    },
    knowledge_sources: [
      {
        title: "Example Source",
        url: "https://example.com/source",
        authority: "web_search",
        confidence: 0.5,
        summary: "Example snippet",
        searchQuery: "bevel modifier does nothing",
      },
    ],
    web_references: "- Title: Example Source\n  Source: https://example.com/source",
  },
});
assert(receipt.line.includes("Web Search"));
assert(!receipt.line.includes("Bevel Modifier Appears to Do Nothing"));
assert.strictEqual(receipt.details.cards[0].title, "Bevel Modifier Appears to Do Nothing");
assert.strictEqual(receipt.details.cards[0].plainSummary, "Blendy used a troubleshooting card: Check scale before judging the bevel.");
assert.strictEqual(receipt.details.cards[0].betterMove, "Check scale before judging the bevel.");
assert.strictEqual(receipt.details.cards[0].sources[0].title, "Bevel Manual");
assert.deepStrictEqual(receipt.details.web.usedQueries, ["bevel modifier does nothing"]);
assert.strictEqual(receipt.details.web.sources[0].url, "https://example.com/source");
assert.strictEqual(receipt.details.web.sources[0].searchQuery, "bevel modifier does nothing");

const liveContextReceipt = assistantReceipt({
  ok: true,
  used: { screenshot: true },
  visualEvidence: [{ kind: "overview", dataUrl: "data:image/png;base64,c2NyZWVu" }],
  promptParts: {},
});
assert.strictEqual(liveContextReceipt.details.usedScene, true);
assert.strictEqual(liveContextReceipt.details.usedScreenshot, true);
assert(liveContextReceipt.details.summary.includes("fresh visual evidence"));

const webPermissionMessages = [
  {
    role: "user",
    content: "What is the newest Blender release available today? Do not answer from memory or my current Blender version.",
  },
  {
    role: "assistant",
    content: "I can't verify that locally. Would you like me to perform a web search?",
  },
];
assert.strictEqual(
  pendingWebLookupPrompt(webPermissionMessages),
  "What is the newest Blender release available today? Do not answer from memory or my current Blender version.",
);
const yesApproval = resolveWebApproval("yes", webPermissionMessages);
assert.strictEqual(yesApproval.webApproved, true);
assert.strictEqual(
  yesApproval.webPrompt,
  "What is the newest Blender release available today? Do not answer from memory or my current Blender version.",
);
const explicitApproval = resolveWebApproval("you can web search", webPermissionMessages);
assert.strictEqual(explicitApproval.webApproved, true);
assert.strictEqual(
  explicitApproval.webPrompt,
  "What is the newest Blender release available today? Do not answer from memory or my current Blender version.",
);
const budgeted = settingsWithModelBudget(
  { responseMaxTokens: 2200, contextLimitTokens: 70000, knowledgeMode: "ASK_BEFORE_WEB" },
  { contextLength: 4096 },
);
assert.strictEqual(budgeted.responseMaxTokens, 2200);
assert.strictEqual(budgeted.contextLimitTokens, 1896);
assert(budgeted.contextLimitTokens + budgeted.responseMaxTokens <= 4096);

const regenerationChat = {
  messages: [
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
    { role: "user", content: "Latest question" },
    { role: "assistant", content: "Old answer that must not be fed back" },
  ],
};
const regenerated = pruneChatForRegeneration(regenerationChat);
assert.strictEqual(regenerated.lastUser.content, "Latest question");
assert.strictEqual(regenerationChat.messages.length, 3);
assert(!JSON.stringify(regenerationChat).includes("Old answer that must not be fed back"));

assert.strictEqual(sanitizeReferenceImages(["data:image/png;base64,c21hbGw="]).length, 1);
assert.throws(() => sanitizeReferenceImages(["data:text/plain;base64,bm8="]), /PNG, JPEG, or WebP/);
assert.strictEqual(isPrivateIp("127.0.0.1"), true);
assert.strictEqual(isPrivateIp("192.168.1.5"), true);
assert.strictEqual(isPrivateIp("8.8.8.8"), false);
assert.strictEqual(normalizeLoopbackHttpUrl("https://evil.example/v1", "http://localhost:1234/v1"), "http://localhost:1234/v1");
assert.strictEqual(normalizeLoopbackHttpUrl("http://127.0.0.1:1234/v1", "http://localhost:1234/v1"), "http://127.0.0.1:1234/v1");
assert(toolDefinitionsForPolicy({ toolUse: "AUTO", knowledgeMode: "ASK_BEFORE_WEB" }, false).every(
  (tool) => !["web_search", "fetch_url"].includes(tool.function.name),
));
assert(toolDefinitionsForPolicy({ toolUse: "AUTO", knowledgeMode: "ASK_BEFORE_WEB" }, true).some(
  (tool) => tool.function.name === "web_search",
));

const gemmaStatus = modelCapabilityStatus("google/gemma-4-test", {
  architecture: "gemma4",
  capabilities: { vision: true, trained_for_tool_use: true },
  loaded_instances: [{ id: "gemma-instance", config: { context_length: 4096 } }],
}, true);
assert.strictEqual(gemmaStatus.vision, true);
assert.strictEqual(gemmaStatus.toolUse, true);
assert.strictEqual(gemmaStatus.contextLength, 4096);
const gemmaPayload = applyModelAdapter({ model: gemmaStatus.modelId, temperature: 0.4 }, {
  temperature: null,
  topP: null,
  topK: null,
}, gemmaStatus);
assert.strictEqual(gemmaPayload.temperature, 1);
assert.strictEqual(gemmaPayload.top_p, 0.95);
assert.strictEqual(gemmaPayload.top_k, 64);
const explicitSampling = applyModelAdapter({ model: gemmaStatus.modelId }, {
  temperature: 0.3,
  topP: 0.8,
  topK: 32,
}, gemmaStatus);
assert.strictEqual(explicitSampling.temperature, 0.3);
assert.strictEqual(explicitSampling.top_p, 0.8);
assert.strictEqual(explicitSampling.top_k, 32);

async function testToolCallLoop() {
  const requests = [];
  sandbox.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/models")) {
      const data = { data: [{ id: "tool-model" }] };
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(data),
      };
    }
    const body = JSON.parse(options.body || "{}");
    requests.push(body);
    const isFirstChatCall = requests.length === 1;
    const data = isFirstChatCall
      ? {
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "search_blender_docs",
                      arguments: JSON.stringify({ query: "bevel modifier" }),
                    },
                  },
                ],
              },
            },
          ],
        }
      : {
          choices: [
            {
              message: {
                role: "assistant",
                content: "Use the Bevel modifier, then check the Amount against your scene units.",
              },
            },
          ],
        };
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => data,
      text: async () => JSON.stringify(data),
      headers: { get: () => "application/json" },
    };
  };

  let streamed = "";
  const completion = await runLmStudioCompletionWithTools({
    settings: {
      lmStudioBaseUrl: "http://localhost:1234/v1",
      model: "auto",
      responseMaxTokens: 8000,
      contextLimitTokens: 70000,
      toolUse: "AUTO",
      knowledgeMode: "LOCAL_ONLY",
    },
    payload: buildChatPayload({
      prompt: "How do I bevel this?",
      context: bridgedContext,
      chat: { compactedSummary: "", messages: [] },
      settings: { model: "auto", responseMaxTokens: 8000, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
    }),
    prompt: "How do I bevel this?",
    context: bridgedContext,
    chat: { compactedSummary: "", messages: [] },
    onDelta(delta) {
      streamed += delta;
    },
  });

  assert.strictEqual(requests.length, 3);
  assert(Array.isArray(requests[0].tools));
  assert.strictEqual(requests[0].tool_choice, "auto");
  assert.strictEqual(requests[0].max_tokens, 1200);
  assert(requests[1].messages.some((message) => message.role === "tool" && message.name === "search_blender_docs"));
  assert.strictEqual(requests[1].max_tokens, 1200);
  assert.strictEqual(requests[2].max_tokens, 6000);
  assert(!Object.prototype.hasOwnProperty.call(requests[2], "tools"));
  assert(completion.text.includes("Bevel modifier"));
  assert.strictEqual(completion.toolTrace[0].call.name, "search_blender_docs");
  assert(streamed.includes("Bevel modifier"));
}

async function testToolDecisionTimeoutFallsBackToDirectAnswer() {
  const requests = [];
  sandbox.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/models")) {
      const data = { data: [{ id: "tool-model" }] };
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(data),
      };
    }
    const body = JSON.parse(options.body || "{}");
    requests.push(body);
    if (requests.length === 1) {
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      throw error;
    }
    const data = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "Add the blood splash as a simple red material detail first.",
          },
        },
      ],
    };
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => data,
      text: async () => JSON.stringify(data),
      headers: { get: () => "application/json" },
    };
  };

  const completion = await runLmStudioCompletionWithTools({
    settings: {
      lmStudioBaseUrl: "http://localhost:1234/v1",
      model: "auto",
      responseMaxTokens: 8000,
      contextLimitTokens: 70000,
      toolUse: "AUTO",
      knowledgeMode: "LOCAL_ONLY",
    },
    payload: buildChatPayload({
      prompt: "How do I make a blood splash design?",
      context: bridgedContext,
      chat: { compactedSummary: "", messages: [] },
      settings: { model: "auto", responseMaxTokens: 8000, toolUse: "AUTO", knowledgeMode: "LOCAL_ONLY" },
    }),
    prompt: "How do I make a blood splash design?",
    context: bridgedContext,
    chat: { compactedSummary: "", messages: [] },
    onDelta() {},
  });

  assert.strictEqual(requests.length, 2);
  assert(Array.isArray(requests[0].tools));
  assert.strictEqual(requests[0].max_tokens, 1200);
  assert(!Object.prototype.hasOwnProperty.call(requests[1], "tools"));
  assert.strictEqual(requests[1].stream, true);
  assert.strictEqual(requests[1].max_tokens, 6000);
  assert(completion.text.includes("blood splash"));
}

testToolCallLoop()
  .then(testToolDecisionTimeoutFallsBackToDirectAnswer)
  .then(() => {
    console.log("Prompt packet diagnostic test passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
