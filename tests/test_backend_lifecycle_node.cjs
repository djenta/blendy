const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const { registerBackendIpc } = require("../blendy/electron/backend.cjs");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    Connection: "close",
  });
  response.end(body);
}

function sendSseEvent(response, data) {
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function waitFor(predicate, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function makeIpcHarness(events) {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      assert(!handlers.has(channel), `Duplicate IPC registration for ${channel}`);
      handlers.set(channel, handler);
    },
  };
  const sender = {
    getURL: () => "file:///C:/Program%20Files/Blendy/index.html",
    isDestroyed: () => false,
    send(channel, payload) { events.push({ channel, payload }); },
  };
  const event = { sender, senderFrame: { url: sender.getURL() } };
  return {
    ipcMain,
    async invoke(channel, ...args) {
      const handler = handlers.get(channel);
      assert(handler, `No IPC handler registered for ${channel}`);
      return handler(event, ...args);
    },
  };
}

function countExactText(haystack, needle) {
  return String(haystack).split(needle).length - 1;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blendy-backend-lifecycle-"));
const bridgeRequests = [];
const lmRequests = [];
const events = [];
const bridgeToken = "test-bridge-v2-token";
const modelId = "google/gemma-4-26b-a4b-qat";
const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const basePngBytes = Buffer.from(imageDataUrl.split(",")[1], "base64");
const regeneratedOverviewDataUrl = `data:image/png;base64,${Buffer.concat([
  basePngBytes,
  Buffer.from("regenerated-overview-sentinel"),
]).toString("base64")}`;
const referenceDataUrl = `data:image/png;base64,${Buffer.concat([
  basePngBytes,
  Buffer.from("named-reference-sentinel"),
]).toString("base64")}`;
const focusedDataUrl = "data:image/png;base64,Zm9jdXNlZA==";
const firstPrompt = "Give me one bevel checkpoint for this test object.";
const cancelPrompt = "CANCEL_STREAM_LIFECYCLE_TEST";
const notebookText = "Project: a small retro radio. Keep the corners soft and the controls oversized.";
const referenceName = "Retro radio target.png";
let resolveCancelStreamStarted;
const cancelStreamStarted = new Promise((resolve) => { resolveCancelStreamStarted = resolve; });
const pendingStreamTimers = new Set();

const bridgeServer = http.createServer(async (request, response) => {
  try {
    if (request.method !== "POST" || request.url !== "/context") {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    const body = await readRequestJson(request);
    bridgeRequests.push({ token: request.headers["x-blendy-token"] || "", body });
    const matchingPromptCaptureCount = body.prompt === firstPrompt
      ? bridgeRequests.filter((item) => item.body.prompt === firstPrompt).length
      : 0;
    const overviewDataUrl = matchingPromptCaptureCount >= 2
      ? regeneratedOverviewDataUrl
      : imageDataUrl;
    if (request.headers["x-blendy-token"] !== bridgeToken) {
      sendJson(response, 401, { error: "missing bridge token" });
      return;
    }
    sendJson(response, 200, {
      protocolVersion: 2,
      system_prompt: "BRIDGE_SYSTEM_PROMPT_MUST_NEVER_REACH_THE_MODEL",
      project: {
        name: "LifecycleFixture.blend",
        path: "C:\\Scenes\\LifecycleFixture.blend",
        appDataPath: tempRoot,
      },
      selected: {
        object: "RadioBody",
        objectType: "MESH",
        mode: "Object",
        dimensions: "2.0 x 1.0 x 0.6 m",
        scale: "1, 1, 1",
        units: "Metric",
      },
      runtimeState: {
        blenderVersion: "4.5.0",
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
      modifiers: [{ name: "Bevel", detail: "Amount 0.03 m; Segments 3" }],
      scene: {
        name: "Scene",
        summary: "1 mesh object named RadioBody",
        materials: ["Cream Plastic"],
      },
      visual: "Captured: Full active Blender window, Focused View 3D evidence.",
      brief: "A small retro radio",
      contextLine: "Used: live Blender scene + full Blender window",
      visualEvidence: [
        { kind: "active_editor", label: "Focused View 3D evidence", editorType: "VIEW_3D", dataUrl: focusedDataUrl },
        { kind: "overview", label: "Full active Blender window", editorType: "SCREEN", dataUrl: overviewDataUrl },
      ],
      used: {
        screenshot: true,
        screenshotOverview: true,
        activeEditorScreenshot: true,
        knowledgeMode: "ASK_BEFORE_WEB",
      },
      bridge: { blenderVersion: "4.5.0", protocolVersion: 2 },
      promptParts: {
        runtime_facts: "Blender version: 4.5.0\nCurrent mode: OBJECT",
        scene_context: "Selected object: RadioBody\nScale: 1, 1, 1",
        scene_diff: "No prior snapshot",
        scene_diagnostic_flags: "No blocking flags",
        semantic_scene_card: "RadioBody is the radio shell.",
        verification_notes: "Screenshot and scene inventory agree.",
        knowledge_status: {
          mode: "ASK_BEFORE_WEB",
          modeLabel: "Ask Before Web",
          lastWebLookupStatus: "not requested",
          confidence: 1,
        },
        knowledge_sources: [],
        router_trace: { webDecision: "local" },
      },
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

const lmServer = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/v1/models") {
      sendJson(response, 200, {
        models: [{
          key: modelId,
          display_name: "Gemma 4 26B A4B QAT",
          architecture: "gemma4",
          type: "llm",
          capabilities: { vision: true, trained_for_tool_use: true, reasoning: false },
          loaded_instances: [{ id: `${modelId}:fixture`, config: { context_length: 32768 } }],
        }],
      });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(response, 200, { data: [{ id: modelId, object: "model" }] });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      sendJson(response, 404, { error: "not found" });
      return;
    }

    const body = await readRequestJson(request);
    lmRequests.push(body);
    const packetText = JSON.stringify(body.messages || []);
    const isCancellationTurn = packetText.includes(cancelPrompt);
    const isToolPlanning = body.stream === false && Array.isArray(body.tools) && body.tools.length > 0;
    const isLiveStateCorrection = packetText.includes("deterministic factual editor");

    if (isToolPlanning) {
      sendJson(response, 200, {
        choices: [{ message: { role: "assistant", content: "NO_TOOL" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      });
      return;
    }
    if (isLiveStateCorrection) {
      sendJson(response, 200, {
        choices: [{ message: { role: "assistant", content: "You are in Object Mode. Press Tab to enter Edit Mode, then select the front face." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      });
      return;
    }

    assert.strictEqual(body.stream, true, "The visible answer should use streaming.");
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "close",
    });

    if (isCancellationTurn) {
      sendSseEvent(response, {
        choices: [{ delta: { content: "This partial answer should be cancelled" }, finish_reason: null }],
      });
      resolveCancelStreamStarted();
      const timer = setTimeout(() => {
        pendingStreamTimers.delete(timer);
        if (!response.destroyed) {
          sendSseEvent(response, { choices: [{ delta: { content: "." }, finish_reason: "stop" }] });
          response.end("data: [DONE]\n\n");
        }
      }, 5000);
      pendingStreamTimers.add(timer);
      request.once("close", () => {
        clearTimeout(timer);
        pendingStreamTimers.delete(timer);
      });
      return;
    }

    sendSseEvent(response, {
      choices: [{ delta: { content: "You are in Object Mode. Press Tab to enter Edit Mode, " }, finish_reason: null }],
    });
    sendSseEvent(response, {
      choices: [{ delta: { content: "then select the front face and inspect the Bevel. Done when all scale values read 1.000." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 900, completion_tokens: 31, total_tokens: 931 },
    });
    response.end("data: [DONE]\n\n");
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, 500, { error: error.message });
    } else {
      response.destroy(error);
    }
  }
});

(async () => {
  try {
    const [bridgePort, lmPort] = await Promise.all([listen(bridgeServer), listen(lmServer)]);
    fs.writeFileSync(
      path.join(tempRoot, "bridge.json"),
      JSON.stringify({
        version: 2,
        protocolVersion: 2,
        url: `http://127.0.0.1:${bridgePort}`,
        port: bridgePort,
        token: bridgeToken,
      }, null, 2),
    );

    const harness = makeIpcHarness(events);
    registerBackendIpc({
      app: { getPath: () => tempRoot },
      ipcMain: harness.ipcMain,
    });

    const backendSettings = {
      lmStudioBaseUrl: `http://127.0.0.1:${lmPort}/v1`,
      model: "auto",
      responseMaxTokens: 3200,
      contextLimitTokens: 70000,
      toolUse: "AUTO",
      knowledgeMode: "ASK_BEFORE_WEB",
    };
    await harness.invoke("blendy:save-backend-settings", backendSettings);

    const state = await harness.invoke("blendy:get-state");
    assert.strictEqual(state.context.bridgeOk, true);
    assert.strictEqual(state.context.bridgeSource, "discovery");
    assert.strictEqual(state.modelStatus.modelId, modelId);
    assert.strictEqual(state.modelStatus.architecture, "gemma4");
    const chatId = state.diagnostics.activeChatId;

    const savedNotebook = await harness.invoke("blendy:save-chat-notebook", { chatId, text: notebookText });
    assert.strictEqual(savedNotebook.text, notebookText);

    const firstSend = await harness.invoke("blendy:send-message", {
      chatId,
      prompt: firstPrompt,
      backendSettings,
      referenceImages: [{ dataUrl: referenceDataUrl, name: referenceName }],
    });
    assert.strictEqual(firstSend.modelStatus.vision, true);
    assert.strictEqual(firstSend.context.screenshotOverviewCaptured, true);
    assert.strictEqual(firstSend.context.screenshotDeliveredToModel, true);
    assert.strictEqual(firstSend.context.effectiveInputLimitTokens, firstSend.context.contextLimitTokens);
    assert.strictEqual(firstSend.context.configuredLimitTokens, firstSend.context.configuredContextLimitTokens);
    assert.strictEqual(firstSend.context.modelContextTokens, firstSend.context.modelContextLength);
    assert.strictEqual(firstSend.context.answerReserveTokens, firstSend.context.responseReserveTokens);

    const firstAssistantId = firstSend.assistantMessage.id;
    const doneEvent = await waitFor(
      () => events.find((item) => item.payload?.type === "assistant-done" && item.payload.id === firstAssistantId),
      "the first assistant-done event",
    );

    const firstTurnRequests = lmRequests.filter((body) => JSON.stringify(body.messages || []).includes(firstPrompt));
    const planningRequests = firstTurnRequests.filter((body) => Array.isArray(body.tools));
    const correctionRequests = firstTurnRequests.filter((body) => JSON.stringify(body.messages || []).includes("deterministic factual editor"));
    const finalPayload = firstTurnRequests.find((body) => body.stream === true && !body.tools);
    assert.strictEqual(planningRequests.length, 0, "Ordinary tutoring prompts must skip tool planning.");
    assert.strictEqual(correctionRequests.length, 0, "The phrase 'enter Edit Mode' must not trigger a false live-state correction.");
    assert(finalPayload, "Expected one streamed, tool-free final payload.");
    assert.strictEqual(countExactText(JSON.stringify(finalPayload.messages), firstPrompt), 1, "Current prompt must appear exactly once.");
    assert(finalPayload.messages[0].content.includes("local, read-only Blender tutor"));
    assert(!JSON.stringify(finalPayload.messages).includes("BRIDGE_SYSTEM_PROMPT_MUST_NEVER_REACH_THE_MODEL"));
    assert.strictEqual(finalPayload.temperature, 0.55);
    assert.strictEqual(finalPayload.top_p, 0.92);
    assert.strictEqual(finalPayload.top_k, 48);
    assert.strictEqual(finalPayload.seed, 3407);

    const submittedUserMessage = finalPayload.messages.at(-1);
    assert.strictEqual(submittedUserMessage.role, "user");
    assert(Array.isArray(submittedUserMessage.content), "Vision payload should use ordered content parts.");
    assert.strictEqual(submittedUserMessage.content[0].type, "image_url");
    assert.strictEqual(submittedUserMessage.content[0].image_url.url, imageDataUrl, "Full Blender overview must be first.");
    assert(submittedUserMessage.content[1].text.includes("full live Blender window"));
    assert.strictEqual(submittedUserMessage.content[2].image_url.url, focusedDataUrl);
    assert(submittedUserMessage.content[3].text.includes("focused live VIEW_3D crop"));
    assert.strictEqual(submittedUserMessage.content[4].image_url.url, referenceDataUrl);
    assert(submittedUserMessage.content[5].text.includes(`user reference target named "${referenceName}"`));
    assert.strictEqual(submittedUserMessage.content.at(-1).type, "text");
    assert(submittedUserMessage.content.at(-1).text.includes(firstPrompt));
    assert(submittedUserMessage.content.at(-1).text.includes(notebookText));
    assert(submittedUserMessage.content.at(-1).text.includes(`USER REFERENCE TARGET named "${referenceName}"`));

    assert(events.some((item) => item.payload?.type === "assistant-stage" && item.payload.id === firstAssistantId && item.payload.stage === "connecting"));
    assert(events.some((item) => item.payload?.type === "assistant-stage" && item.payload.id === firstAssistantId && item.payload.stage === "writing"));
    assert(!events.some((item) => item.payload?.type === "assistant-stage" && item.payload.id === firstAssistantId && item.payload.stage === "verifying-state"));
    assert.strictEqual(doneEvent.payload.receipt.line, "Used: live Blender context");
    assert.strictEqual(doneEvent.payload.receipt.details.usedScene, true);
    assert.strictEqual(doneEvent.payload.receipt.details.usedScreenshot, true);
    assert.strictEqual(doneEvent.payload.receipt.details.referenceImageCount, 1);
    assert.strictEqual(doneEvent.payload.receipt.details.referenceNames[0], referenceName);
    assert.strictEqual(doneEvent.payload.liveStateCorrection.applied, false);
    assert.strictEqual(doneEvent.payload.usage.reported, true);
    assert.strictEqual(doneEvent.payload.usage.promptTokens, 900);
    assert.strictEqual(doneEvent.payload.usage.completionTokens, 31);
    assert.strictEqual(doneEvent.payload.usage.totalTokens, 931);
    assert.strictEqual(doneEvent.payload.usage.requestCount, 1);

    const persistedAfterDone = JSON.parse(fs.readFileSync(firstSend.diagnostics.chatPath, "utf8"));
    assert.strictEqual(persistedAfterDone.projectNotebook, notebookText);
    assert.strictEqual(persistedAfterDone.lastUsage.totalTokens, 931);
    assert.strictEqual(persistedAfterDone.lastUsage.reported, true);
    assert(persistedAfterDone.messages.some(
      (message) => message.id === firstSend.userMessage.id && message.role === "user" && message.content === firstPrompt,
    ));
    const persistedDoneAssistant = persistedAfterDone.messages.find((message) => message.id === firstAssistantId);
    assert.strictEqual(persistedDoneAssistant.status, "done");
    assert(persistedDoneAssistant.content.includes("enter Edit Mode"));
    assert.strictEqual(persistedDoneAssistant.receipt.usedScene, true);
    assert.strictEqual(persistedDoneAssistant.receipt.usedScreenshot, true);
    assert.strictEqual(persistedDoneAssistant.receipt.referenceNames[0], referenceName);
    assert.strictEqual(persistedDoneAssistant.usage.totalTokens, 931);
    assert.strictEqual(persistedDoneAssistant.liveStateCorrection.applied, false);

    const packet = JSON.parse(fs.readFileSync(firstSend.diagnostics.promptPacketPath, "utf8"));
    assert.strictEqual(packet.actualUsage.totalTokens, 931);
    assert.strictEqual(packet.actualUsage.reported, true);
    assert.strictEqual(packet.completionDiagnostics.liveStateCorrection.applied, false);
    assert(!JSON.stringify(packet).includes(imageDataUrl));
    assert(!JSON.stringify(packet).includes(referenceDataUrl));
    assert(!JSON.stringify(packet).includes("data:image/png;base64"));

    assert(bridgeRequests.length >= 1, "Expected the user turn to request fresh Blender context.");
    assert(bridgeRequests.every((request) => request.token === bridgeToken), "Every bridge request must use the discovery token.");
    const firstPromptBridgeRequest = bridgeRequests.find((request) => request.body.prompt === firstPrompt);
    assert(firstPromptBridgeRequest, "Expected the submitted prompt to traverse the bridge.");
    assert.strictEqual(firstPromptBridgeRequest.body.screenshot, "always");

    const lmRequestCountBeforeRegenerate = lmRequests.length;
    const bridgeRequestCountBeforeRegenerate = bridgeRequests.length;
    const regenerate = await harness.invoke("blendy:regenerate-last", {
      chatId,
      backendSettings,
      referenceImages: [{ dataUrl: referenceDataUrl, name: referenceName }],
    });
    const regenerateAssistantId = regenerate.assistantMessage.id;
    const regenerateDoneEvent = await waitFor(
      () => events.find((item) => item.payload?.type === "assistant-done" && item.payload.id === regenerateAssistantId),
      "the regenerated assistant-done event",
    );

    const regeneratedBridgeRequests = bridgeRequests
      .slice(bridgeRequestCountBeforeRegenerate)
      .filter((request) => request.body.prompt === firstPrompt);
    assert.strictEqual(regeneratedBridgeRequests.length, 1, "Regeneration should request one fresh Blender context.");
    assert.strictEqual(regeneratedBridgeRequests[0].body.screenshot, "always");

    const regeneratedLmRequests = lmRequests
      .slice(lmRequestCountBeforeRegenerate)
      .filter((body) => JSON.stringify(body.messages || []).includes(firstPrompt));
    const regeneratedFinalPayload = regeneratedLmRequests.find((body) => body.stream === true && !body.tools);
    assert(regeneratedFinalPayload, "Expected a streamed regenerated answer payload.");
    assert.strictEqual(
      countExactText(JSON.stringify(regeneratedFinalPayload.messages), firstPrompt),
      1,
      "Regeneration must submit the original user prompt exactly once.",
    );
    const regeneratedUserMessage = regeneratedFinalPayload.messages.at(-1);
    assert.strictEqual(regeneratedUserMessage.role, "user");
    assert(Array.isArray(regeneratedUserMessage.content), "Regeneration should preserve multimodal content ordering.");
    assert.strictEqual(regeneratedUserMessage.content[0].type, "image_url");
    assert.strictEqual(
      regeneratedUserMessage.content[0].image_url.url,
      regeneratedOverviewDataUrl,
      "Regeneration must use the newly captured full-window overview, not the prior turn's image.",
    );
    assert(regeneratedUserMessage.content[1].text.includes("full live Blender window"));
    assert.strictEqual(regeneratedUserMessage.content[2].image_url.url, focusedDataUrl);
    assert(regeneratedUserMessage.content[3].text.includes("focused live VIEW_3D crop"));
    assert.strictEqual(regeneratedUserMessage.content[4].image_url.url, referenceDataUrl);
    assert(regeneratedUserMessage.content[5].text.includes(`user reference target named "${referenceName}"`));
    const regeneratedContextText = regeneratedUserMessage.content.at(-1).text;
    assert(regeneratedContextText.includes(firstPrompt));
    assert(regeneratedContextText.includes(`USER REFERENCE TARGET named "${referenceName}"`));
    assert(regeneratedContextText.includes("Full-window requirement: satisfied and delivered to the model"));

    assert.strictEqual(regenerateDoneEvent.payload.receipt.details.usedScreenshot, true);
    assert.strictEqual(regenerateDoneEvent.payload.receipt.details.referenceImageCount, 1);
    assert.strictEqual(regenerateDoneEvent.payload.receipt.details.referenceNames[0], referenceName);

    const persistedAfterRegenerate = await waitFor(() => {
      const chat = JSON.parse(fs.readFileSync(regenerate.diagnostics.chatPath, "utf8"));
      const message = chat.messages.find((item) => item.id === regenerateAssistantId);
      return message?.status === "done" ? chat : null;
    }, "the persisted regenerated assistant");
    assert.strictEqual(
      persistedAfterRegenerate.messages.filter((message) => message.role === "user" && message.content === firstPrompt).length,
      1,
      "Regeneration must not duplicate the persisted user turn.",
    );
    const persistedRegeneratedAssistant = persistedAfterRegenerate.messages.find(
      (message) => message.id === regenerateAssistantId,
    );
    assert.strictEqual(persistedRegeneratedAssistant.receipt.usedScreenshot, true);
    assert.strictEqual(persistedRegeneratedAssistant.receipt.referenceNames[0], referenceName);

    const regeneratedPacket = JSON.parse(fs.readFileSync(regenerate.diagnostics.promptPacketPath, "utf8"));
    const regeneratedPacketText = JSON.stringify(regeneratedPacket);
    assert(regeneratedPacketText.includes("[omitted Blender screen screenshot data]"));
    assert(!regeneratedPacketText.includes(regeneratedOverviewDataUrl));
    assert(!regeneratedPacketText.includes(referenceDataUrl));
    assert(!regeneratedPacketText.includes(focusedDataUrl));
    assert(!regeneratedPacketText.includes("data:image/png;base64"));

    const cancelSend = await harness.invoke("blendy:send-message", {
      chatId,
      prompt: cancelPrompt,
      backendSettings,
    });
    const cancelAssistantId = cancelSend.assistantMessage.id;
    await Promise.race([
      cancelStreamStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Cancellation stream did not start.")), 3000)),
    ]);
    const cancelResult = await harness.invoke("blendy:cancel-message", { messageId: cancelAssistantId });
    assert.deepStrictEqual(cancelResult, { ok: true, messageId: cancelAssistantId });

    const cancelledEvent = await waitFor(
      () => events.find((item) => item.payload?.type === "assistant-cancelled" && item.payload.id === cancelAssistantId),
      "the assistant-cancelled event",
    );
    assert.strictEqual(cancelledEvent.payload.content, "Stopped before the response finished.");
    const persistedAfterCancel = await waitFor(() => {
      const chat = JSON.parse(fs.readFileSync(cancelSend.diagnostics.chatPath, "utf8"));
      const message = chat.messages.find((item) => item.id === cancelAssistantId);
      return message?.status === "cancelled" ? chat : null;
    }, "the persisted cancelled assistant");
    const persistedCancelledAssistant = persistedAfterCancel.messages.find((message) => message.id === cancelAssistantId);
    assert.strictEqual(persistedCancelledAssistant.content, "Stopped before the response finished.");
    const cancelBridgeRequest = bridgeRequests.find((request) => request.body.prompt === cancelPrompt);
    assert.strictEqual(cancelBridgeRequest.body.screenshot, "always");
    assert(lmRequests.some(
      (body) => body.stream === true && !body.tools && JSON.stringify(body.messages || []).includes(cancelPrompt),
    ));

    console.log("Backend lifecycle integration test passed.");
  } finally {
    for (const timer of pendingStreamTimers) clearTimeout(timer);
    pendingStreamTimers.clear();
    await Promise.all([closeServer(bridgeServer), closeServer(lmServer)]);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
