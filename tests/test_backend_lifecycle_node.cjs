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
    request.on("data", (chunk) => {
      body += chunk;
    });
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
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function closeServer(server) {
  if (!server.listening) {
    return;
  }
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
    send(channel, payload) {
      events.push({ channel, payload });
    },
  };
  const event = {
    sender,
    senderFrame: { url: sender.getURL() },
  };
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
const imageDataUrl = `data:image/png;base64,${Buffer.from("fake-png-for-lifecycle-test").toString("base64")}`;
const firstPrompt = "Give me one bevel checkpoint for this test object.";
const cancelPrompt = "CANCEL_STREAM_LIFECYCLE_TEST";
const notebookText = "Project: a small retro radio. Keep the corners soft and the controls oversized.";
let resolveCancelStreamStarted;
const cancelStreamStarted = new Promise((resolve) => {
  resolveCancelStreamStarted = resolve;
});
const pendingStreamTimers = new Set();

const bridgeServer = http.createServer(async (request, response) => {
  try {
    if (request.method !== "POST" || request.url !== "/context") {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    const body = await readRequestJson(request);
    bridgeRequests.push({
      token: request.headers["x-blendy-token"] || "",
      body,
    });
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
        mode: "OBJECT",
        dimensions: "2.0 x 1.0 x 0.6 m",
        scale: "1, 1, 1",
        units: "Metric",
      },
      modifiers: [{ name: "Bevel", detail: "Amount 0.03 m; Segments 3" }],
      scene: {
        name: "Scene",
        summary: "1 mesh object named RadioBody",
        materials: ["Cream Plastic"],
      },
      visual: "Fresh active editor crop captured",
      brief: "A small retro radio",
      contextLine: "Used: live Blender scene + fresh active editor crop",
      screenshotDataUrl: imageDataUrl,
      visualEvidence: [{ kind: "active-editor", label: "3D Viewport", dataUrl: imageDataUrl }],
      used: { screenshot: true, knowledgeMode: "ASK_BEFORE_WEB" },
      bridge: { blenderVersion: "4.5.0", protocolVersion: 2 },
      promptParts: {
        runtime_facts: "Blender version: 4.5.0\nMode: OBJECT",
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
        models: [
          {
            key: modelId,
            display_name: "Gemma 4 26B A4B QAT",
            architecture: "gemma4",
            type: "llm",
            capabilities: {
              vision: true,
              trained_for_tool_use: true,
              reasoning: false,
            },
            loaded_instances: [
              {
                id: `${modelId}:fixture`,
                config: { context_length: 32768 },
              },
            ],
          },
        ],
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

    if (isToolPlanning) {
      sendJson(response, 200, {
        choices: [
          {
            message: { role: "assistant", content: "NO_TOOL" },
            finish_reason: "stop",
          },
        ],
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
      choices: [{ delta: { content: "Select RadioBody and keep it in Object Mode. " }, finish_reason: null }],
    });
    sendSseEvent(response, {
      choices: [{ delta: { content: "Press Ctrl+A, choose Scale, then inspect the Bevel. Done when all scale values read 1.000." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 900, completion_tokens: 31 },
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
      JSON.stringify(
        {
          version: 2,
          protocolVersion: 2,
          url: `http://127.0.0.1:${bridgePort}`,
          port: bridgePort,
          token: bridgeToken,
        },
        null,
        2,
      ),
    );

    const harness = makeIpcHarness(events);
    registerBackendIpc({
      app: { getPath: (name) => (name === "userData" ? tempRoot : tempRoot) },
      ipcMain: harness.ipcMain,
    });

    const state = await harness.invoke("blendy:get-state");
    assert.strictEqual(state.context.bridgeOk, true);
    assert.strictEqual(state.context.bridgeSource, "discovery");
    assert.strictEqual(state.modelStatus.modelId, modelId);
    assert.strictEqual(state.modelStatus.architecture, "gemma4");
    const chatId = state.diagnostics.activeChatId;

    const savedNotebook = await harness.invoke("blendy:save-chat-notebook", {
      chatId,
      text: notebookText,
    });
    assert.strictEqual(savedNotebook.text, notebookText);

    const firstSend = await harness.invoke("blendy:send-message", {
      chatId,
      prompt: firstPrompt,
      backendSettings: {
        lmStudioBaseUrl: `http://127.0.0.1:${lmPort}/v1`,
        model: "auto",
        toolUse: "AUTO",
        knowledgeMode: "ASK_BEFORE_WEB",
      },
    });
    const firstAssistantId = firstSend.assistantMessage.id;
    const doneEvent = await waitFor(
      () => events.find((item) => item.payload?.type === "assistant-done" && item.payload.id === firstAssistantId),
      "the first assistant-done event",
    );

    const firstTurnRequests = lmRequests.filter((body) => JSON.stringify(body.messages || []).includes(firstPrompt));
    const finalPayload = firstTurnRequests.find((body) => body.stream === true && !body.tools);
    assert(finalPayload, "Expected a streamed, tool-free final Gemma payload.");
    assert.strictEqual(countExactText(JSON.stringify(finalPayload.messages), firstPrompt), 1, "Current prompt must appear exactly once.");
    assert(finalPayload.messages[0].content.includes("You are Blendy, a local Blender tutor"));
    assert(!JSON.stringify(finalPayload.messages).includes("BRIDGE_SYSTEM_PROMPT_MUST_NEVER_REACH_THE_MODEL"));
    assert.strictEqual(finalPayload.temperature, 1);
    assert.strictEqual(finalPayload.top_p, 0.95);
    assert.strictEqual(finalPayload.top_k, 64);

    const submittedUserMessage = finalPayload.messages.at(-1);
    assert.strictEqual(submittedUserMessage.role, "user");
    assert(Array.isArray(submittedUserMessage.content), "Vision payload should use ordered content parts.");
    assert.strictEqual(submittedUserMessage.content[0].type, "image_url", "Image evidence must precede text for Gemma.");
    assert.strictEqual(submittedUserMessage.content.at(-1).type, "text");
    assert(submittedUserMessage.content.at(-1).text.includes(firstPrompt));
    assert(submittedUserMessage.content.at(-1).text.includes(notebookText));

    assert(
      events.some(
        (item) => item.payload?.type === "assistant-stage"
          && item.payload.id === firstAssistantId
          && item.payload.stage === "connecting",
      ),
      "Expected a connecting stage event.",
    );
    assert(
      events.some(
        (item) => item.payload?.type === "assistant-stage"
          && item.payload.id === firstAssistantId
          && item.payload.stage === "writing",
      ),
      "Expected a writing stage event.",
    );
    assert.strictEqual(doneEvent.payload.receipt.line, "Used: live Blender context");
    assert.strictEqual(doneEvent.payload.receipt.details.usedScene, true);
    assert.strictEqual(doneEvent.payload.receipt.details.usedScreenshot, true);

    const persistedAfterDone = JSON.parse(fs.readFileSync(firstSend.diagnostics.chatPath, "utf8"));
    assert.strictEqual(persistedAfterDone.projectNotebook, notebookText);
    assert(
      persistedAfterDone.messages.some(
        (message) => message.id === firstSend.userMessage.id && message.role === "user" && message.content === firstPrompt,
      ),
    );
    const persistedDoneAssistant = persistedAfterDone.messages.find((message) => message.id === firstAssistantId);
    assert.strictEqual(persistedDoneAssistant.status, "done");
    assert(persistedDoneAssistant.content.includes("Press Ctrl+A"));
    assert.strictEqual(persistedDoneAssistant.receipt.usedScene, true);
    assert.strictEqual(persistedDoneAssistant.receipt.usedScreenshot, true);

    assert(bridgeRequests.length >= 3, "Expected state, notebook, and send context requests.");
    assert(bridgeRequests.every((request) => request.token === bridgeToken), "Every bridge request must use the discovery token.");
    const firstPromptBridgeRequest = bridgeRequests.find((request) => request.body.prompt === firstPrompt);
    assert(firstPromptBridgeRequest, "Expected the submitted prompt to traverse the bridge.");
    assert.strictEqual(firstPromptBridgeRequest.body.screenshot, "auto");

    const cancelSend = await harness.invoke("blendy:send-message", {
      chatId,
      prompt: cancelPrompt,
      backendSettings: {
        lmStudioBaseUrl: `http://127.0.0.1:${lmPort}/v1`,
        model: "auto",
        toolUse: "AUTO",
      },
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
    assert(
      lmRequests.some(
        (body) => body.stream === true
          && !body.tools
          && JSON.stringify(body.messages || []).includes(cancelPrompt),
      ),
      "Expected cancellation to reach a waiting LM Studio stream.",
    );

    console.log("Backend lifecycle integration test passed.");
  } finally {
    for (const timer of pendingStreamTimers) {
      clearTimeout(timer);
    }
    pendingStreamTimers.clear();
    await Promise.all([closeServer(bridgeServer), closeServer(lmServer)]);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
