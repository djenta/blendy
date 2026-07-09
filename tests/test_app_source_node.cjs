const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(repoRoot, "blendy", "src", "App.tsx"), "utf8");

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
assert(appSource.includes("toolDefinitionTokens"), "Context UI should show tool definition/reserve accounting.");
assert(appSource.includes("imageReserveTokens"), "Context UI should show screenshot reserve accounting.");
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
