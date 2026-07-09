const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const backendPath = path.join(repoRoot, "blendy", "electron", "backend.cjs");
const backendSource =
  fs.readFileSync(backendPath, "utf8") +
  "\nmodule.exports.__test__ = { writePromptPacket, sanitizePromptPacketMessages, cleanModelText, buildChatPayload, buildContextText, estimateContextUsage, runLmStudioCompletionWithTools, assistantContextLine, assistantReceipt, resolveWebApproval, pendingWebLookupPrompt, bridgeHonoredWebApproval, staleBridgeWebApprovalMessage, shouldSendScreenshot };\n";

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
  bridgeHonoredWebApproval,
  staleBridgeWebApprovalMessage,
  shouldSendScreenshot,
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
  messages: [{ role: "assistant", content: "Earlier answer." }],
};
const bridgedPayload = buildChatPayload({
  prompt: "Where should this attach?",
  context: bridgedContext,
  chat: bridgedChat,
  settings: { model: "gemma-test", responseMaxTokens: 8000 },
});

assert(bridgedPayload.messages[0].content.includes("PYTHON SYSTEM PROMPT"));
assert(!bridgedPayload.messages[0].content.includes("You are Blendy"));
assert(!bridgedPayload.messages.at(-1).content.includes("Bridge-built context"));
assert(bridgedPayload.messages.at(-1).content.includes("TOOL USE"));
assert(bridgedPayload.messages.at(-1).content.includes("Remember that the user named the small part a connector."));
assert(Array.isArray(bridgedPayload.tools));
assert(bridgedPayload.tools.some((tool) => tool.function.name === "web_search"));
assert.strictEqual(bridgedPayload.tool_choice, "auto");

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
assert.strictEqual(bridgeHonoredWebApproval({ promptParts: {} }, yesApproval), false);
assert.strictEqual(bridgeHonoredWebApproval({ promptParts: { web_approved: true } }, yesApproval), true);
assert(staleBridgeWebApprovalMessage().includes("did not search the web yet"));

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
  const finalText = await runLmStudioCompletionWithTools({
    settings: {
      lmStudioBaseUrl: "http://localhost:1234/v1",
      model: "auto",
      responseMaxTokens: 8000,
      contextLimitTokens: 70000,
      toolUse: "AUTO",
    },
    payload: buildChatPayload({
      prompt: "How do I bevel this?",
      context: bridgedContext,
      chat: { compactedSummary: "", messages: [] },
      settings: { model: "auto", responseMaxTokens: 8000, toolUse: "AUTO" },
    }),
    prompt: "How do I bevel this?",
    context: bridgedContext,
    chat: { compactedSummary: "", messages: [] },
    onDelta(delta) {
      streamed += delta;
    },
  });

  assert.strictEqual(requests.length, 2);
  assert(Array.isArray(requests[0].tools));
  assert.strictEqual(requests[0].tool_choice, "auto");
  assert(requests[1].messages.some((message) => message.role === "tool" && message.name === "search_blender_docs"));
  assert(finalText.includes("Bevel modifier"));
  assert(streamed.includes("Bevel modifier"));
}

testToolCallLoop()
  .then(() => {
    console.log("Prompt packet diagnostic test passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
