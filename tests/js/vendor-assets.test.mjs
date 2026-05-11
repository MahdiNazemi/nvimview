import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { describe, it } from "node:test";

const vendorFiles = [
  "extension/vendor/xterm/xterm.css",
  "extension/vendor/xterm/xterm.js",
  "extension/vendor/xterm/addon-fit.js",
  "extension/vendor/xterm/addon-webgl.js",
  "extension/vendor/xterm/LICENSE.xterm",
  "extension/vendor/xterm/LICENSE.addon-fit",
  "extension/vendor/xterm/LICENSE.addon-webgl",
];

describe("vendored xterm assets", () => {
  it("includes the runtime files loaded by the extension viewer", () => {
    for (const file of vendorFiles) {
      assert.equal(existsSync(file), true, `${file} should exist`);
    }
  });

  it("keeps xterm assets refreshed from npm packages", () => {
    assert.equal(
      readFileSync("extension/vendor/xterm/xterm.js", "utf8"),
      readFileSync("node_modules/@xterm/xterm/lib/xterm.js", "utf8"),
    );
    assert.equal(
      readFileSync("extension/vendor/xterm/addon-fit.js", "utf8"),
      readFileSync("node_modules/@xterm/addon-fit/lib/addon-fit.js", "utf8"),
    );
    assert.equal(
      readFileSync("extension/vendor/xterm/addon-webgl.js", "utf8"),
      readFileSync("node_modules/@xterm/addon-webgl/lib/addon-webgl.js", "utf8"),
    );
  });
});
