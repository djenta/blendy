const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const backendPath = path.join(repoRoot, "blendy", "electron", "backend.cjs");
const backendSource =
  fs.readFileSync(backendPath, "utf8") +
  "\nmodule.exports.__test__ = { writePromptPacket, sanitizePromptPacketMessages, cleanModelText, buildChatPayload, buildContextText, assistantContextLine, assistantReceipt, resolveWebApproval, pendingWebLookupPrompt, bridgeHonoredWebApproval, staleBridgeWebApprovalMessage };\n";

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
  assistantContextLine,
  assistantReceipt,
  resolveWebApproval,
  pendingWebLookupPrompt,
  bridgeHonoredWebApproval,
  staleBridgeWebApprovalMessage,
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
          { type: "text", text: "ROUTER DECISION\nSelected route: troubleshooting" },
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
assert(packetText.includes("ROUTER DECISION"));
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
assert(bridgedPayload.messages.at(-1).content.includes("Bridge-built context"));
assert(bridgedPayload.messages.at(-1).content.includes("Remember that the user named the small part a connector."));

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

console.log("Prompt packet diagnostic test passed.");
