const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "blendy", "src", "referenceImages.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const ts = require(path.join(repoRoot, "blendy", "node_modules", "typescript"));
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function("exports", "module", "require", compiled)(moduleUnderTest.exports, moduleUnderTest, require);
const { inferReferenceMimeType } = moduleUnderTest.exports;

assert.strictEqual(inferReferenceMimeType("desktop-photo.JPG", ""), "image/jpeg");
assert.strictEqual(inferReferenceMimeType("camera-export.jfif", "application/octet-stream"), "image/jpeg");
assert.strictEqual(inferReferenceMimeType("screenshot.png", "image/png"), "image/png");
assert.strictEqual(inferReferenceMimeType("reference.webp", "image/webp; charset=binary"), "image/webp");
assert.strictEqual(inferReferenceMimeType("windows-photo.jpg", "image/pjpeg"), "image/jpeg");
assert.strictEqual(inferReferenceMimeType("iphone-photo.heic", ""), "image/jpeg");
assert.strictEqual(inferReferenceMimeType("phone-export.avif", "image/avif"), "image/jpeg");
assert.strictEqual(inferReferenceMimeType("unsupported.pdf", "application/pdf"), "");

console.log("Reference image type regression test passed.");
