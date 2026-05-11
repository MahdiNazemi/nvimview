import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadExtensionScripts } from "./load-extension-script.mjs";

const nvimview = loadExtensionScripts([
  "extension/shared/defaults.js",
  "extension/shared/filetypes.js",
  "extension/shared/url-rules.js",
]);

describe("filetype detection", () => {
  it("detects markdown from text/plain headers and filename hints", () => {
    const settings = nvimview.getDefaultSettings();
    const result = nvimview.detectFileType({
      url: "https://example.test/README.md",
      mimeType: "text/plain; charset=utf-8",
      sample: "# Hello\n",
      settings,
    });

    assert.equal(result.id, "markdown");
    assert.equal(result.nvimFiletype, "markdown");
    assert.equal(result.eligible, true);
  });

  it("does not activate for GitHub-style HTML pages with code-like paths", () => {
    const settings = nvimview.getDefaultSettings();
    const result = nvimview.detectFileType({
      url: "https://github.com/example/project/blob/main/main.py",
      mimeType: "text/html",
      sample: "<!doctype html><main>repository page</main>",
      settings,
    });

    assert.equal(result.eligible, false);
  });

  it("leaves JSON unchecked by default", () => {
    const settings = nvimview.getDefaultSettings();
    const result = nvimview.detectFileType({
      url: "https://example.test/data.json",
      mimeType: "application/json",
      sample: '{"ok": true}',
      settings,
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, "not-allowed");
  });

  it("leaves unknown binary viewer types inactive by default", () => {
    const settings = nvimview.getDefaultSettings();
    for (const [url, mimeType] of [
      ["https://example.test/doc.pdf", "application/pdf"],
      ["https://example.test/image.svg", "image/svg+xml"],
      ["https://example.test/photo.png", "image/png"],
    ]) {
      const result = nvimview.detectFileType({ url, mimeType, sample: "", settings });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "unknown-filetype");
    }
  });

  it("opens JSON when the file type is checked", () => {
    const settings = nvimview.getDefaultSettings();
    settings.fileTypes.allowTypeIds.push("json");
    const result = nvimview.detectFileType({
      url: "https://example.test/data.json",
      mimeType: "application/json",
      sample: '{"ok": true}',
      settings,
    });

    assert.equal(result.eligible, true);
    assert.equal(result.id, "json");
  });

  it("opens user-added file types when their IDs are checked", () => {
    const settings = nvimview.getDefaultSettings();
    settings.fileTypes.customDefinitions = [
      {
        id: "typst",
        label: "Typst",
        nvimFiletype: "typst",
        extensions: ["typ"],
      },
    ];
    settings.fileTypes.allowTypeIds.push("typst");

    const result = nvimview.detectFileType({
      url: "https://example.test/paper.typ",
      mimeType: "text/plain",
      sample: "#set page(width: auto)",
      settings,
    });

    assert.equal(result.eligible, true);
    assert.equal(result.id, "typst");
    assert.equal(result.nvimFiletype, "typst");
  });

  it("keeps binary-looking samples out of Neovim", () => {
    const settings = nvimview.getDefaultSettings();
    const result = nvimview.detectFileType({
      url: "https://example.test/file.py",
      mimeType: "text/plain",
      sample: "abc\u0000def",
      settings,
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, "binary-sample");
  });
});

describe("url rules", () => {
  it("denies wildcard host matches before filetype activation", () => {
    const settings = nvimview.getDefaultSettings();
    settings.urlRules.deny = [{ kind: "host", pattern: "*.example.test" }];

    assert.equal(
      nvimview.isUrlDenied("https://raw.example.test/file.py", settings),
      true,
    );
    assert.equal(nvimview.isUrlDenied("https://other.test/file.py", settings), false);
  });

  it("supports exact host and URL substring deny rules", () => {
    const settings = nvimview.getDefaultSettings();
    settings.urlRules.deny = [
      { kind: "host", pattern: "example.test" },
      { kind: "urlContains", pattern: "/generated/" },
    ];

    assert.equal(nvimview.isUrlDenied("https://example.test/file.py", settings), true);
    assert.equal(
      nvimview.isUrlDenied("https://other.test/generated/file.py", settings),
      true,
    );
    assert.equal(nvimview.isUrlDenied("https://other.test/file.py", settings), false);
  });
});
