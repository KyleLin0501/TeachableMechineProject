const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const docsDir = path.join(rootDir, "docs");
const apiBaseUrl = (process.env.PUBLIC_API_BASE_URL || "").trim();

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function clearDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function copyDir(sourceDir, targetDir) {
  ensureDir(targetDir);

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

clearDir(docsDir);
copyDir(publicDir, docsDir);

fs.writeFileSync(
  path.join(docsDir, "config.js"),
  `window.APP_CONFIG = ${JSON.stringify({ API_BASE_URL: apiBaseUrl }, null, 2)};\n`
);

fs.writeFileSync(path.join(docsDir, ".nojekyll"), "");

console.log(`Built GitHub Pages files in ${docsDir}`);
console.log(`API base URL: ${apiBaseUrl || "(same-origin / not set)"}`);
