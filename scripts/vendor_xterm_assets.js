#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vendorDir = path.join(root, "extension", "vendor", "xterm");

const assets = [
  ["@xterm/xterm/lib/xterm.js", "xterm.js"],
  ["@xterm/xterm/lib/xterm.js.map", "xterm.js.map"],
  ["@xterm/xterm/css/xterm.css", "xterm.css"],
  ["@xterm/xterm/LICENSE", "LICENSE.xterm"],
  ["@xterm/addon-fit/lib/addon-fit.js", "addon-fit.js"],
  ["@xterm/addon-fit/lib/addon-fit.js.map", "addon-fit.js.map"],
  ["@xterm/addon-fit/LICENSE", "LICENSE.addon-fit"],
  ["@xterm/addon-webgl/lib/addon-webgl.js", "addon-webgl.js"],
  ["@xterm/addon-webgl/lib/addon-webgl.js.map", "addon-webgl.js.map"],
  ["@xterm/addon-webgl/LICENSE", "LICENSE.addon-webgl"],
];

fs.rmSync(vendorDir, { recursive: true, force: true });
fs.mkdirSync(vendorDir, { recursive: true });

for (const [modulePath, targetName] of assets) {
  const source = require.resolve(modulePath, { paths: [root] });
  fs.copyFileSync(source, path.join(vendorDir, targetName));
}

console.log(`Vendored ${assets.length} xterm.js assets into ${vendorDir}`);
