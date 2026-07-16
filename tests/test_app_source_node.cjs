const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(repoRoot, "blendy", "src", "App.tsx"), "utf8");
const studioSource = fs.readFileSync(path.join(repoRoot, "blendy", "src", "StudioCoach.tsx"), "utf8");
const stylesSource = fs.readFileSync(path.join(repoRoot, "blendy", "src", "styles.css"), "utf8");
const mainSource = fs.readFileSync(path.join(repoRoot, "blendy", "electron", "main.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(repoRoot, "blendy", "electron", "preload.cjs"), "utf8");

assert(mainSource.includes("sandbox: true"), "Electron renderer must run in Chromium's sandbox.");
assert(mainSource.includes("setWindowOpenHandler"), "New windows must be intercepted instead of inheriting app privileges.");
assert(mainSource.includes('parsed.protocol === "https:"'), "Only validated HTTPS source links may open externally.");
assert(mainSource.includes('on("will-navigate"'), "Unexpected top-level renderer navigation must be blocked.");
assert(preloadSource.includes("getModelStatus"), "Preload should expose local-model readiness checks.");
assert(preloadSource.includes("cancelMessage"), "Preload should expose generation cancellation.");
assert(preloadSource.includes("saveChatNotebook"), "Preload should expose per-chat project notebook persistence.");

assert(
  !appSource.includes('key={activeChatId || "no-active-chat"}'),
  "Composer textarea must not remount on chat changes; remounting can break typing after deleting a chat.",
);
assert(appSource.includes("composerFocusRequest"), "Composer focus request state should exist.");
assert(appSource.includes("function requestComposerFocus()"), "Chat management should request composer focus after async state settles.");
assert(
  !appSource.includes("window.confirm("),
  "Delete chat should use an in-app confirmation, not a native modal that can break Electron focus.",
);
assert(appSource.includes("confirmingDeleteChatId"), "Delete chat should use explicit in-app confirmation state.");
assert(appSource.includes('label="Tool use"'), "Settings should expose Tool Use instead of old Auto Web routing.");
assert(appSource.includes('title="Instructions"'), "Settings should include a user instructions panel.");
assert(appSource.includes("userInstructions"), "Settings should persist user instructions through backend settings.");
assert(appSource.includes("toolDefinitionTokens"), "Context UI should show tool definition/reserve accounting.");
assert(appSource.includes("imageReserveTokens"), "Context UI should show screenshot reserve accounting.");
assert(!appSource.includes("<ReadinessPanel"), "Chat should not show a model-readiness check button beside the chat controls.");
assert(appSource.includes('className="header-chat-controls"'), "Context and chat history controls should live in the title bar.");
assert(!appSource.includes('className="floating-controls"'), "Context and chat history controls should no longer float over the chat.");
assert(appSource.includes("cancelMessage"), "Generation should provide a cancellable Stop flow.");
assert(appSource.includes("<CurrentCheckpoint"), "Completed answers should expose checkpoint recovery actions.");
assert(appSource.includes("saveChatNotebook"), "Project notebook changes should be saved per chat.");
assert(appSource.includes("referenceImages"), "Composer should send attached reference images to the local model.");
assert(
  appSource.includes('Local Blender guidance'),
  "The titlebar subtitle should stay short and static instead of repeating generation stages.",
);
assert(
  !appSource.includes('disabled={isGenerating}\n                  supportsVision'),
  "Reference images should remain selectable for the next turn while the current answer is generating.",
);
assert(
  appSource.includes("inferReferenceMimeType"),
  "Desktop image validation should fall back to the filename when Windows omits the MIME type.",
);
assert(
  studioSource.includes('accept="image/*,.png,.jpg,.jpeg,.jfif,.webp,.bmp,.gif,.avif,.heic,.heif,.tif,.tiff"'),
  "The desktop picker should expose normal image files by MIME type and extension.",
);
assert(appSource.includes("prepareReferenceImage"), "Selected photos should be decoded and re-encoded before LM Studio receives them.");
assert(
  !studioSource.includes('<span><Compass size={16} /> Current checkpoint</span>'),
  "The composer should not repeat the latest answer inside a separate checkpoint summary.",
);
assert(!studioSource.includes("function ReadinessPanel"), "The removed readiness control should not remain as unused UI code.");
assert(stylesSource.includes(".header-chat-controls"), "Title-bar chat controls should have their own layout styling.");
assert(appSource.includes('label="Web access"'), "Settings should separate web policy from tool use.");
assert(appSource.includes('"ASK_BEFORE_WEB"'), "Ask before web should be offered as the safe web policy.");
assert(appSource.includes("modelStatus"), "Settings and chat should surface loaded model capabilities.");
assert(appSource.includes("ColorStudio"), "Settings should expose a dedicated color studio.");
assert(appSource.includes("colorOverrides"), "Theme color choices should persist in app settings.");
assert(stylesSource.includes("--theme-assistant-bar"), "The Blendy message bar should have its own theme color token.");
assert(stylesSource.includes(".color-swatch-control"), "Each theme color should have an interactive swatch control.");
for (const [operation, nextOperation] of [
  ["compactNow", "freshChat"],
  ["freshChat", "switchChat"],
  ["switchChat", "beginRenameChat"],
  ["deleteChat", "captureViewport"],
]) {
  const operationMatch = appSource.match(new RegExp(`async function ${operation}[\\s\\S]*?(?:async )?function ${nextOperation}`));
  assert(operationMatch, `${operation} should be present.`);
  assert(operationMatch[0].includes("operationNotice("), `${operation} failures should render an operation notice.`);
}
assert(
  !appSource.includes("Auto Web can fetch docs"),
  "Settings copy should not describe old pre-answer Auto Web fetching.",
);

const deleteChatMatch = appSource.match(/async function deleteChat[\s\S]*?async function captureViewport/);
assert(deleteChatMatch, "deleteChat function should be present.");
assert(
  deleteChatMatch[0].includes("requestComposerFocus();"),
  "Deleting a chat should request composer focus after the replacement chat renders.",
);

function assertAppearsBefore(source, before, after, message) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert(beforeIndex >= 0 && afterIndex >= 0 && beforeIndex < afterIndex, message);
}

const sendPromptMatch = appSource.match(/async function sendPrompt[\s\S]*?function handlePromptKeyDown/);
assert(sendPromptMatch, "sendPrompt function should be present.");
const sendPromptSource = sendPromptMatch[0];
assert(
  sendPromptSource.includes("referenceImages.map(({ name, dataUrl }) => ({ name, dataUrl }))"),
  "Sending a message should preserve each reference image name alongside its data URL.",
);
assert(
  sendPromptSource.includes("if (!cleanPrompt || isGenerating || notebookSaving || referencePreparing)"),
  "Sending should be blocked while a reference image is still being prepared.",
);
assertAppearsBefore(
  sendPromptSource,
  "await persistNotebookDraft()",
  "window.blendyApp.sendMessage",
  "The project notebook must persist before a message is sent.",
);
assert(
  !sendPromptSource.includes("setReferenceImages([])"),
  "A successful answer must not silently clear named reference images.",
);

const regenerateMatch = appSource.match(/async function regenerateLatest[\s\S]*?async function compactNow/);
assert(regenerateMatch, "regenerateLatest function should be present.");
const regenerateSource = regenerateMatch[0];
assert(
  regenerateSource.includes("referenceImages.map(({ name, dataUrl }) => ({ name, dataUrl }))"),
  "Regeneration should resend named reference images as { name, dataUrl } objects.",
);
assertAppearsBefore(
  regenerateSource,
  "await persistNotebookDraft()",
  "window.blendyApp.regenerateLast",
  "The project notebook must persist before regenerating an answer.",
);
assert(
  !regenerateSource.includes("setReferenceImages([])"),
  "Regenerating must not silently clear named reference images.",
);

const closeWindowMatch = appSource.match(/async function closeAppWindow[\s\S]*?function handleScroll/);
assert(closeWindowMatch, "closeAppWindow function should be present.");
assertAppearsBefore(
  closeWindowMatch[0],
  "await persistNotebookDraft()",
  "window.blendyWindow?.close()",
  "Unsaved notebook text must persist before the window closes.",
);
assert(appSource.includes("lastNotebookAutoSaveAttemptRef"), "Notebook autosave attempts should be tracked.");
assert(
  appSource.includes("persistNotebookDraft({ silent: true })"),
  "Notebook edits should autosave silently after the debounce.",
);

assert(appSource.includes("Estimated next request"), "Context UI should label next-turn usage as an estimate.");
assert(appSource.includes("Last measured by LM Studio"), "Context UI should distinguish measured LM Studio usage.");
assert(appSource.includes("configuredLimitTokens"), "Context UI should consume the configured context cap.");
assert(appSource.includes("effectiveInputLimitTokens"), "Context UI should consume the effective input budget.");
assert(appSource.includes("lastActualPromptTokens"), "Context UI should display measured prompt-token usage.");
assert(appSource.includes("function nextRequestEstimate("), "Next-request context should have a dedicated estimate helper.");
assert(appSource.includes("snapshotReferenceCount"), "Next-request estimates should track references already included in the current snapshot.");
assert(
  appSource.includes("baseTokens - currentImageReserve + imageReserveTokens"),
  "Attached references should replace the snapshot image reserve instead of being double-counted.",
);
assert(
  sendPromptSource.includes("acceptContextSnapshot(result.context, requestReferences.length)"),
  "The sent packet should record how many references its returned context already includes.",
);

assert(
  sendPromptSource.includes('operationNotice("Message was not sent"'),
  "A locally caught send/preflight failure should render a non-regenerating operation notice.",
);
assert(
  sendPromptSource.includes("if (!promptRef.current.trim()) setPrompt(cleanPrompt);"),
  "A locally caught send/preflight failure should restore the unsent prompt to the composer.",
);
const sendFailureCatch = sendPromptSource.match(/} catch \(error\) \{[\s\S]*?setGenerationStage\(undefined\);\r?\n    \}/);
assert(sendFailureCatch, "The local send failure catch should be present.");
assert(
  !sendFailureCatch[0].includes('role: "assistant"'),
  "The local preflight failure path must not create a Retry-capable assistant row for an older persisted prompt.",
);
assert(
  appSource.includes("newestResponseOutcome") && appSource.includes('message.role === "event" && message.status === "failed"'),
  "A newer operation failure should suppress recovery controls belonging to an older successful answer.",
);
assert(
  appSource.includes('const latestAssistant = newestAssistant?.status === "done"'),
  "Check, Stuck, and Where should only appear when the newest response outcome completed successfully.",
);
assert(
  appSource.includes("actions={latestAssistant ? <CurrentCheckpoint"),
  "Checkpoint shortcuts should be gated by the newest successfully completed assistant turn.",
);
assert(
  appSource.includes("message.id === newestAssistant?.id"),
  "Each message row should know whether it is the newest actionable assistant turn.",
);
assert(
  appSource.includes('isLatestAssistant && (message.status === "failed" || message.status === "cancelled")'),
  "Retry should only appear on the newest persisted failed or cancelled assistant turn.",
);

assert(appSource.includes("referencePreparationTokenRef"), "Reference preparation should have an invalidation token.");
assert(appSource.includes("const preparationChatId = activeChatId;"), "Reference preparation should remember its originating chat.");
assert(
  appSource.includes("activeChatIdRef.current !== preparationChatId"),
  "A reference prepared after its originating chat changes must be discarded.",
);
assert(
  appSource.includes("notebookSaving || referencePreparing || chatId === activeChatId"),
  "Chat switching should be blocked while a reference is still preparing.",
);

assert(appSource.includes('setEvidenceCaptureState("capturing")'), "Each send should enter a current-turn capturing state.");
assert(
  appSource.includes("setEvidenceCaptureState(evidenceStateFromContext(result.context))"),
  "Fresh screenshot delivery should only be reported after backend context returns.",
);
assert(
  !studioSource.includes("isGenerating && usedScreenshot"),
  "Evidence UI must not combine a prior-turn screenshot flag with current generation state.",
);
assert(studioSource.includes('captureState === "capturing"'), "Evidence UI should show an explicit current-turn capturing state.");
assert(
  sendPromptSource.includes('setEvidenceCaptureState("idle")') && regenerateSource.includes('setEvidenceCaptureState("idle")'),
  "Notebook-save aborts should clear capturing state before returning.",
);

assert(stylesSource.includes(".context-usage-button.generation-compact"), "Context usage should compact while Stop is visible.");
assert(stylesSource.includes(".titlebar.generating .chat-history-control"), "Disabled chat history should hide during generation at narrow widths.");
assert(appSource.includes('className={`titlebar ${isGenerating ? "generating" : ""}`}'), "The title bar should expose generation layout state.");

assert(mainSource.includes('event.preventDefault();'), "System close should pause until the renderer protects notebook edits.");
assert(mainSource.includes('webContents.send("window:close-requested")'), "Main should request renderer close approval.");
assert(mainSource.includes('ipcMain.handle("window:confirm-close"'), "Main should accept renderer close approval.");
assert(mainSource.includes('ipcMain.handle("window:cancel-close"'), "Main should allow the renderer to cancel an unsafe close.");
assert(preloadSource.includes("onCloseRequested"), "Preload should expose system-close requests without Node access.");
assert(preloadSource.includes("confirmClose"), "Preload should expose safe close approval.");
assert(appSource.includes("async function handleSystemCloseRequest()"), "App should save notebook state before approving system close.");
assertAppearsBefore(
  appSource.match(/async function handleSystemCloseRequest[\s\S]*?async function closeAppWindow/)[0],
  "await persistNotebookDraft()",
  "window.blendyWindow?.confirmClose()",
  "System close approval must happen after notebook persistence.",
);

for (const label of ["> Check", "> Stuck", "> Where"]) {
  assert(studioSource.includes(label), `Current checkpoint should retain the ${label.slice(2)} shortcut.`);
}
console.log("App source regression test passed.");
