import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadExtensionScripts } from "./load-extension-script.mjs";

const nvimview = loadExtensionScripts([
  "extension/shared/zoom.js",
  "extension/viewer/session.js",
]);

describe("terminal viewer protocol helpers", () => {
  it("exposes the terminal protocol helper surface", () => {
    for (const helper of [
      "FragmentReassembler",
      "createTerminalOptions",
      "decodeBase64Bytes",
      "encodeBinaryString",
      "enforceViewerZoom",
      "installCursorStyleHandler",
      "resetCurrentTabZoomToDefault",
      "zoomFactorFromPercent",
    ]) {
      assert.equal(typeof nvimview[helper], "function", helper);
    }
  });

  it("reassembles fragmented native messages", () => {
    const fragments = [
      {
        type: "fragment",
        fragmentId: "x",
        index: 1,
        count: 2,
        payloadBase64: btoa('":"ready"}'),
      },
      {
        type: "fragment",
        fragmentId: "x",
        index: 0,
        count: 2,
        payloadBase64: btoa('{"type'),
      },
    ];

    const reassembler = new nvimview.FragmentReassembler();
    assert.equal(reassembler.add(fragments[0]), null);
    assert.equal(reassembler.add(fragments[1]).type, "ready");
  });

  it("evicts old incomplete native-message fragments", () => {
    const reassembler = new nvimview.FragmentReassembler(1);

    assert.equal(
      reassembler.add({
        type: "fragment",
        fragmentId: "old",
        index: 0,
        count: 2,
        payloadBase64: btoa('{"type"'),
      }),
      null,
    );
    assert.equal(
      reassembler.add({
        type: "fragment",
        fragmentId: "new",
        index: 0,
        count: 1,
        payloadBase64: btoa('{"type":"ready"}'),
      }).type,
      "ready",
    );
    assert.equal(reassembler.pending.has("old"), false);
  });

  it("keeps PTY byte payloads lossless through base64 helpers", () => {
    const binaryString = "\x00A\xff";

    assert.equal(nvimview.encodeBinaryString(binaryString), btoa(binaryString));
    assert.deepEqual([...nvimview.decodeBase64Bytes(btoa(binaryString))], [0, 65, 255]);
  });

  it("creates terminal options without overriding cursor style or theme colors", () => {
    const options = nvimview.createTerminalOptions({
      fontFamily: "Test Mono",
      fontSizePx: 20,
      cursorBlink: false,
    });

    assert.equal(options.cursorBlink, false);
    assert.equal(options.cursorStyle, undefined);
    assert.equal(options.theme, undefined);
    assert.equal(options.fontFamily, "Test Mono");
    assert.equal(options.fontSize, 20);
    assert.equal(options.altClickMovesCursor, false);
    assert.equal(options.macOptionClickForcesSelection, true);
    assert.equal(options.rightClickSelectsWord, true);
  });

  it("lets the user opt into cursor blinking", () => {
    const options = nvimview.createTerminalOptions({
      cursorBlink: true,
    });

    assert.equal(options.cursorBlink, true);
  });

  it("coerces Neovim cursor shapes to steady variants when blink is disabled", () => {
    const registrations = [];
    const terminal = {
      options: {},
      parser: {
        registerCsiHandler(identifier, handler) {
          registrations.push({ identifier, handler });
          return { dispose() {} };
        },
      },
    };

    nvimview.installCursorStyleHandler(terminal, { cursorBlink: false });

    assert.equal(registrations[0].identifier.intermediates, " ");
    assert.equal(registrations[0].identifier.final, "q");
    assert.equal(registrations[0].handler([1]), true);
    assert.deepEqual(terminal.options, {
      cursorBlink: false,
      cursorStyle: "block",
    });
    assert.equal(registrations[0].handler([3]), true);
    assert.deepEqual(terminal.options, {
      cursorBlink: false,
      cursorStyle: "underline",
    });
    assert.equal(registrations[0].handler([5]), true);
    assert.deepEqual(terminal.options, {
      cursorBlink: false,
      cursorStyle: "bar",
    });
    assert.equal(registrations[0].handler([0]), true);
    assert.deepEqual(terminal.options, {
      cursorBlink: false,
      cursorStyle: undefined,
    });
  });

  it("blocks DEC private cursor blink mode while preserving other private modes", () => {
    const registrations = [];
    const terminal = {
      options: {},
      parser: {
        registerCsiHandler(identifier, handler) {
          registrations.push({ identifier, handler });
          return { dispose() {} };
        },
      },
    };

    nvimview.installCursorStyleHandler(terminal, { cursorBlink: false });

    assert.equal(registrations[1].identifier.prefix, "?");
    assert.equal(registrations[1].identifier.final, "h");
    assert.equal(registrations[2].identifier.prefix, "?");
    assert.equal(registrations[2].identifier.final, "l");
    assert.equal(registrations[1].handler([12]), true);
    assert.deepEqual(terminal.options, { cursorBlink: false });
    assert.equal(registrations[2].handler([12]), true);
    assert.deepEqual(terminal.options, { cursorBlink: false });
    assert.equal(registrations[1].handler([25]), false);
  });

  it("leaves Neovim cursor control untouched when blink is enabled", () => {
    let registered = false;
    const terminal = {
      parser: {
        registerCsiHandler() {
          registered = true;
        },
      },
    };

    assert.equal(
      nvimview.installCursorStyleHandler(terminal, { cursorBlink: true }),
      null,
    );
    assert.equal(registered, false);
  });

  it("sets viewer tab zoom without changing Firefox zoom settings", async () => {
    const calls = [];
    const tabId = await nvimview.enforceViewerZoom({
      browserApi: {
        tabs: {
          getCurrent: async () => ({ id: 42 }),
          setZoom: async (id, zoom) => calls.push(["setZoom", id, zoom]),
          setZoomSettings: async () => {
            throw new Error("setZoomSettings should not be called");
          },
        },
      },
      zoomPercent: 125,
    });

    assert.equal(tabId, 42);
    assert.deepEqual(calls, [["setZoom", 42, 1.25]]);
  });

  it("resets non-viewer extension pages to browser default zoom without zoom settings", async () => {
    const calls = [];
    const tabId = await nvimview.resetCurrentTabZoomToDefault({
      browserApi: {
        tabs: {
          getCurrent: async () => ({ id: 7 }),
          setZoom: async (id, zoom) => calls.push(["setZoom", id, zoom]),
          setZoomSettings: async (id, settings) =>
            calls.push(["setZoomSettings", id, settings]),
        },
      },
    });

    assert.equal(tabId, 7);
    assert.equal(JSON.stringify(calls), JSON.stringify([["setZoom", 7, 0]]));
  });
});
