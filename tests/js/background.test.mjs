import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadExtensionScripts } from "./load-extension-script.mjs";

function loadBackground(
  fetchStub = async () => {
    throw new Error("fetch should not run");
  },
  initialLocal = {},
  settingsOverride = {},
) {
  const listeners = {};
  const localStore = { ...initialLocal };
  const nvimview = loadExtensionScripts(
    [
      "extension/shared/defaults.js",
      "extension/shared/filetypes.js",
      "extension/shared/url-rules.js",
      "extension/options/settings-schema.js",
      "extension/background/activation.js",
      "extension/background/background.js",
    ],
    {
      AbortController,
      browser: {
        action: { onClicked: { addListener() {} } },
        runtime: {
          getURL: (path) => `moz-extension://nvimview/${path}`,
          onMessage: {
            addListener(listener) {
              listeners.message = listener;
            },
          },
          openOptionsPage() {},
        },
        storage: {
          local: {
            get: async (key) => {
              if (key === null) {
                return { ...localStore };
              }
              return {};
            },
            remove: async (keys) => {
              for (const key of Array.isArray(keys) ? keys : [keys]) {
                delete localStore[key];
              }
              listeners.removedLocalKeys = keys;
            },
            set: async (value) => {
              Object.assign(localStore, value);
              listeners.storedSession = Object.values(value)[0];
            },
          },
          sync: {
            get: async () => ({
              settings: {
                ...nvimview.getDefaultSettings(),
                ...settingsOverride,
                viewer: {
                  ...nvimview.getDefaultSettings().viewer,
                  startupCommand: "call CustomLeftExplorer()",
                  startupCommandEnabled: true,
                  ...(settingsOverride.viewer || {}),
                },
              },
            }),
          },
        },
        tabs: {
          update: async (tabId, value) => {
            listeners.updatedTab = { tabId, value };
          },
        },
        webRequest: {
          onHeadersReceived: {
            addListener(listener, filter) {
              listeners.headers = listener;
              listeners.mainFrameFilter = filter;
            },
          },
        },
      },
      console: { warn() {} },
      fetch: fetchStub,
    },
  );
  return { listeners, nvimview };
}

describe("background activation", () => {
  function abortError() {
    const error = new Error("aborted");
    error.name = "AbortError";
    return error;
  }

  it("does not snapshot text/html main-frame responses", async () => {
    let fetches = 0;
    const { listeners } = loadBackground(async () => {
      fetches += 1;
      throw new Error("unexpected fetch");
    });

    const result = await listeners.headers({
      responseHeaders: [{ name: "content-type", value: "text/html; charset=utf-8" }],
      url: "https://example.test/blob/main/file.py",
    });

    assert.equal(Object.keys(result).length, 0);
    assert.equal(fetches, 0);
  });

  it("opens eligible local files from the content-script path", async () => {
    const { listeners } = loadBackground();

    const result = await listeners.message(
      {
        type: "nvimview.maybeOpen",
        mimeType: "text/plain",
        sample: "print('ok')\n",
        url: "file:///tmp/example.py",
      },
      { tab: { id: 7 } },
    );

    assert.equal(result.eligible, true);
    assert.equal(listeners.updatedTab.tabId, 7);
    assert.match(
      listeners.updatedTab.value.url,
      /^moz-extension:\/\/nvimview\/viewer\/viewer.html/,
    );
    assert.equal(listeners.storedSession.fileUrl, "file:///tmp/example.py");
    assert.equal(listeners.storedSession.sourceKind, "local");
    assert.equal(listeners.storedSession.readOnly, false);
    assert.equal(listeners.storedSession.snapshotBase64, undefined);
    assert.equal(listeners.storedSession.startupCommand, "call CustomLeftExplorer()");
    assert.equal(listeners.storedSession.settings.cursorBlink, false);
    assert.equal(
      JSON.stringify(listeners.storedSession.projectRootMarkers),
      JSON.stringify([
        { path: ".git", strategy: "highest" },
        { path: "AGENTS.md", strategy: "highest" },
        { path: "CLAUDE.md", strategy: "highest" },
        { path: ".claude", strategy: "highest" },
      ]),
    );
  });

  it("uses content-script text for HTTP snapshots without refetching", async () => {
    let fetches = 0;
    const { listeners } = loadBackground(async () => {
      fetches += 1;
      throw new Error("private raw pages should not be refetched");
    });
    const pageText = "# README\n\nprivate content\n";

    const result = await listeners.message(
      {
        type: "nvimview.maybeOpen",
        mimeType: "text/plain; charset=utf-8",
        pageText,
        sample: pageText,
        url: "https://gitlab-master.example.test/user/project/-/raw/main/README.md",
      },
      { tab: { id: 7 } },
    );

    assert.equal(result.eligible, true);
    assert.equal(fetches, 0);
    assert.equal(listeners.storedSession.fileUrl, "");
    assert.equal(listeners.storedSession.sourceKind, "snapshot");
    assert.equal(listeners.storedSession.readOnly, true);
    assert.equal(listeners.storedSession.nvimFiletype, "markdown");
    assert.equal(listeners.storedSession.suggestedName, "README.md");
    assert.equal(
      Buffer.from(listeners.storedSession.snapshotBase64, "base64").toString("utf8"),
      pageText,
    );
  });

  it("rejects oversized content-script snapshots without opening a session", async () => {
    const { listeners, nvimview } = loadBackground();

    const result = await listeners.message(
      {
        type: "nvimview.maybeOpen",
        mimeType: "text/plain",
        pageText: "x".repeat(nvimview.MAX_HTTP_SNAPSHOT_BYTES + 1),
        sample: "x".repeat(128),
        url: "https://example.test/large.md",
      },
      { tab: { id: 7 } },
    );

    assert.equal(result.eligible, false);
    assert.equal(result.reason, "snapshot-too-large");
    assert.equal(listeners.storedSession, undefined);
    assert.equal(listeners.updatedTab, undefined);
  });

  it("does not register file URLs for header redirects", () => {
    const { listeners } = loadBackground();

    assert.equal(
      JSON.stringify(listeners.mainFrameFilter),
      JSON.stringify({ urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }),
    );
  });

  it("stores the enabled startup command in viewer sessions", async () => {
    const { listeners } = loadBackground(
      async () =>
        new Response("print('ok')\n", {
          headers: { "content-type": "text/plain" },
        }),
    );

    await listeners.headers({
      responseHeaders: [{ name: "content-type", value: "text/plain" }],
      url: "https://example.test/example.py",
    });

    assert.equal(listeners.storedSession.startupCommand, "call CustomLeftExplorer()");
    assert.equal(listeners.storedSession.mouseMode, "selection");
    assert.equal(listeners.storedSession.settings.cursorBlink, false);
    assert.equal(listeners.storedSession.settings.renderer, "webgl");
    assert.equal(listeners.storedSession.settings.zoomPercent, 100);
  });

  it("omits the startup command when the setting is disabled", async () => {
    const { listeners } = loadBackground(
      async () =>
        new Response("print('ok')\n", {
          headers: { "content-type": "text/plain" },
        }),
      {},
      {
        viewer: {
          startupCommand: "call CustomLeftExplorer()",
          startupCommandEnabled: false,
        },
      },
    );

    await listeners.headers({
      responseHeaders: [{ name: "content-type", value: "text/plain" }],
      url: "https://example.test/example.py",
    });

    assert.equal(listeners.storedSession.startupCommand, "");
  });

  it("rejects oversized HTTP snapshots while reading the stream", async () => {
    let cancelled = false;
    let nvimview;
    ({ nvimview } = loadBackground(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(nvimview.MAX_HTTP_SNAPSHOT_BYTES + 1));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "text/plain" } },
        ),
    ));

    await assert.rejects(
      () => nvimview.fetchSnapshot("https://example.test/raw.py"),
      /larger than the configured limit/,
    );
    assert.equal(cancelled, true);
  });

  it("aborts HTTP snapshot fetches after the configured timeout", async () => {
    const { nvimview } = loadBackground(async (_url, options) => {
      await new Promise((resolve) => {
        options.signal.addEventListener("abort", resolve, { once: true });
      });
      throw abortError();
    });

    await assert.rejects(
      () => nvimview.fetchSnapshot("https://example.test/raw.py", { timeoutMs: 1 }),
      /aborted/,
    );
  });

  it("lets the browser handle aborted header snapshots", async () => {
    const { listeners } = loadBackground(async () => {
      throw abortError();
    });

    const result = await listeners.headers({
      responseHeaders: [{ name: "content-type", value: "text/plain" }],
      statusCode: 200,
      url: "https://example.test/example.py",
    });

    assert.equal(JSON.stringify(result), JSON.stringify({}));
    assert.equal(listeners.storedSession, undefined);
  });

  it("does not redirect unsuccessful HTTP status codes", async () => {
    let fetches = 0;
    const { listeners } = loadBackground(async () => {
      fetches += 1;
      throw new Error("fetch should not run for unsuccessful statuses");
    });

    const result = await listeners.headers({
      responseHeaders: [{ name: "content-type", value: "text/plain" }],
      statusCode: 404,
      url: "https://example.test/example.py",
    });

    assert.equal(JSON.stringify(result), JSON.stringify({}));
    assert.equal(fetches, 0);
  });

  it("purges stale viewer sessions before storing new ones", async () => {
    const { listeners, nvimview } = loadBackground(async () => {}, {
      "session:stale": { createdAt: 0 },
      other: { createdAt: 0 },
    });

    await nvimview.purgeExpiredSessions();

    assert.equal(
      JSON.stringify(listeners.removedLocalKeys),
      JSON.stringify(["session:stale"]),
    );
  });
});
