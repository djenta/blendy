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
assert(appSource.includes("<ReadinessPanel"), "Chat should show Blender and model readiness before generation.");
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
assert(
  stylesSource.includes(".readiness-panel.compact"),
  "Readiness and generation controls should float compactly instead of consuming a full chat row.",
);
assert(appSource.includes('label="Web access"'), "Settings should separate web policy from tool use.");
assert(appSource.includes('"ASK_BEFORE_WEB"'), "Ask before web should be offered as the safe web policy.");
assert(appSource.includes("modelStatus"), "Settings and chat should surface loaded model capabilities.");
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

console.log("App source regression test passed.");
