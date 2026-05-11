import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadExtensionScripts } from "./load-extension-script.mjs";

const nvimview = loadExtensionScripts([
  "extension/shared/defaults.js",
  "extension/options/settings-schema.js",
]);

describe("settings validation", () => {
  it("round trips exported settings", () => {
    const settings = nvimview.getDefaultSettings();
    settings.viewer.startupCommandEnabled = true;
    settings.viewer.startupCommand = "call CustomLeftExplorer()";

    const exported = nvimview.exportSettings(settings);
    const imported = nvimview.importSettings(exported);

    assert.equal(imported.viewer.startupCommandEnabled, true);
    assert.equal(imported.viewer.startupCommand, "call CustomLeftExplorer()");
    assert.equal(imported.viewer.zoomPercent, 100);
    assert.equal(imported.schemaVersion, settings.schemaVersion);
  });

  it("rejects invalid viewer zoom values", () => {
    const settings = nvimview.getDefaultSettings();
    settings.viewer.zoomPercent = 20;

    assert.throws(() => nvimview.validateSettings(settings), /zoom/i);
  });

  it("rejects invalid viewer renderers", () => {
    const settings = nvimview.getDefaultSettings();
    settings.viewer.renderer = "unknown";

    assert.throws(() => nvimview.validateSettings(settings), /renderer/i);
  });

  it("normalizes a blank renderer to the default renderer", () => {
    const settings = nvimview.getDefaultSettings();
    settings.viewer.renderer = "";

    const validated = nvimview.validateSettings(settings);

    assert.equal(validated.viewer.renderer, "webgl");
  });

  it("rejects invalid viewer mouse modes", () => {
    const settings = nvimview.getDefaultSettings();
    settings.viewer.mouseMode = "unknown";

    assert.throws(() => nvimview.validateSettings(settings), /mouse mode/i);
  });

  it("restores missing sections from defaults", () => {
    const imported = nvimview.importSettings(JSON.stringify({ schemaVersion: 1 }));

    assert.equal(imported.viewer.startupCommandEnabled, false);
    assert.equal(imported.viewer.startupCommand, "");
    assert.equal(imported.viewer.fontSizePx, 20);
    assert.equal(imported.viewer.cursorBlink, false);
    assert.equal(imported.viewer.mouseMode, "selection");
    assert.equal(imported.viewer.renderer, "webgl");
    assert.equal(imported.viewer.zoomPercent, 100);
    assert.equal(
      JSON.stringify(imported.viewer.projectRootMarkers),
      JSON.stringify([
        { path: ".git", strategy: "highest" },
        { path: "AGENTS.md", strategy: "highest" },
        { path: "CLAUDE.md", strategy: "highest" },
        { path: ".claude", strategy: "highest" },
      ]),
    );
    assert.match(imported.viewer.fontFamily, /MesloLGS NF/);
    assert.ok(imported.fileTypes.allowTypeIds.includes("markdown"));
    assert.equal(imported.fileTypes.allowTypeIds.includes("json"), false);
  });

  it("accepts valid custom file types", () => {
    const settings = nvimview.getDefaultSettings();
    settings.fileTypes.customDefinitions = [
      {
        id: "typst",
        label: "Typst",
        nvimFiletype: "typst",
        extensions: [".typ"],
      },
    ];

    const validated = nvimview.validateSettings(settings);

    assert.deepEqual(validated.fileTypes.customDefinitions[0].extensions, ["typ"]);
  });

  it("accepts project root marker strategies", () => {
    const settings = nvimview.getDefaultSettings();
    settings.viewer.projectRootMarkers = [
      { path: "package.json", strategy: "nearest" },
    ];

    const validated = nvimview.validateSettings(settings);

    assert.equal(
      JSON.stringify(validated.viewer.projectRootMarkers),
      JSON.stringify([{ path: "package.json", strategy: "nearest" }]),
    );
  });

  it("rejects absolute project root markers", () => {
    const settings = nvimview.getDefaultSettings();
    settings.viewer.projectRootMarkers = [{ path: "/tmp/.git", strategy: "highest" }];

    assert.throws(() => nvimview.validateSettings(settings), /root markers/i);
  });

  it("rejects unsupported project root marker strategies", () => {
    const settings = nvimview.getDefaultSettings();
    settings.viewer.projectRootMarkers = [{ path: "package.json", strategy: "lowest" }];

    assert.throws(() => nvimview.validateSettings(settings), /marker strategy/i);
  });

  it("formats empty custom file types as empty text so the placeholder is visible", () => {
    assert.equal(nvimview.formatCustomDefinitions([]), "");
  });

  it("formats custom file types as editable JSON when present", () => {
    const text = nvimview.formatCustomDefinitions([
      {
        id: "typst",
        label: "Typst",
        nvimFiletype: "typst",
        extensions: ["typ"],
      },
    ]);

    assert.match(text, /"id": "typst"/);
    assert.match(text, /\n$/);
  });

  it("rejects custom file types without matchers", () => {
    const settings = nvimview.getDefaultSettings();
    settings.fileTypes.customDefinitions = [
      {
        id: "empty",
        label: "Empty",
        nvimFiletype: "text",
      },
    ];

    assert.throws(() => nvimview.validateSettings(settings), /matcher/i);
  });
});
