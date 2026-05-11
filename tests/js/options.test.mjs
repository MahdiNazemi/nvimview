import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { describe, it } from "node:test";

import { loadExtensionScripts } from "./load-extension-script.mjs";

function createElementStub(id = "") {
  return {
    id,
    checked: false,
    dataset: {},
    textContent: "",
    value: "",
    addEventListener() {},
    append(...children) {
      this.children = [...(this.children || []), ...children];
    },
    replaceChildren(...children) {
      this.children = children;
    },
  };
}

function createDocumentStub() {
  const elements = new Map();
  return {
    createElement: (tagName) => createElementStub(tagName),
    createTextNode: (textContent) => ({ textContent }),
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElementStub(id));
      }
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
  };
}

describe("options page", () => {
  it("resets its tab to Firefox's default zoom on load", async () => {
    const calls = [];
    const document = createDocumentStub();

    loadExtensionScripts(
      [
        "extension/shared/defaults.js",
        "extension/shared/zoom.js",
        "extension/options/settings-schema.js",
        "extension/options/options.js",
      ],
      {
        document,
        TextEncoder,
        browser: {
          extension: {},
          runtime: {
            connectNative() {
              throw new Error("diagnostics should not run during load");
            },
          },
          storage: {
            sync: {
              get: async () => ({}),
            },
          },
          tabs: {
            getCurrent: async () => ({ id: 11 }),
            setZoom: async (id, zoom) => calls.push(["setZoom", id, zoom]),
            setZoomSettings: async (id, settings) =>
              calls.push(["setZoomSettings", id, settings]),
          },
        },
      },
    );

    await setImmediate();
    await setImmediate();

    assert.deepEqual(calls, [["setZoom", 11, 0]]);
    assert.match(
      document.getElementById("project-root-markers").value,
      /highest CLAUDE\.md/,
    );
  });
});
