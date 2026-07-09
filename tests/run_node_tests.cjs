const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const testsDirectory = __dirname;
const testFiles = fs
  .readdirSync(testsDirectory)
  .filter((name) => /^test_.*\.cjs$/.test(name))
  .sort();

if (!testFiles.length) {
  console.error("No Node test files were found.");
  process.exit(1);
}

for (const testFile of testFiles) {
  const fullPath = path.join(testsDirectory, testFile);
  console.log(`\n[Node test] ${testFile}`);
  const result = spawnSync(process.execPath, [fullPath], {
    cwd: path.resolve(testsDirectory, ".."),
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`\n${testFiles.length} Node test files passed.`);
