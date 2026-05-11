import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadExtensionScripts } from "./load-extension-script.mjs";

const nvimview = loadExtensionScripts([
  "extension/shared/defaults.js",
  "extension/shared/filetypes.js",
  "extension/shared/url-rules.js",
  "extension/background/activation.js",
]);

describe("activation", () => {
  it("rejects non-file and non-http schemes", () => {
    const settings = nvimview.getDefaultSettings();

    for (const url of [
      "about:config",
      "view-source:https://example.test/a.py",
      "data:text/plain,print(1)",
      "blob:https://example.test/id",
    ]) {
      const result = nvimview.evaluateActivation({
        url,
        mimeType: "text/plain",
        sample: "print(1)",
        settings,
      });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "unsupported-scheme");
    }
  });

  it("activates allowed HTTP source files", () => {
    const settings = nvimview.getDefaultSettings();
    const result = nvimview.evaluateActivation({
      url: "https://example.test/a.py",
      mimeType: "text/plain",
      sample: "print(1)",
      settings,
    });

    assert.equal(result.eligible, true);
    assert.equal(result.nvimFiletype, "python");
    assert.equal(result.sourceKind, "snapshot");
  });

  it("activates allowed local files as local sources", () => {
    const settings = nvimview.getDefaultSettings();
    const result = nvimview.evaluateActivation({
      url: "file:///tmp/a.md",
      mimeType: "text/plain",
      sample: "# hello",
      settings,
    });

    assert.equal(result.eligible, true);
    assert.equal(result.sourceKind, "local");
  });
});
