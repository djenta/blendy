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

const deleteChatMatch = appSource.match(/async function deleteChat[\s\S]*?async function captureViewport/);
assert(deleteChatMatch, "deleteChat function should be present.");
assert(
  deleteChatMatch[0].includes("requestComposerFocus();"),
  "Deleting a chat should request composer focus after the replacement chat renders.",
);

console.log("App source regression test passed.");
