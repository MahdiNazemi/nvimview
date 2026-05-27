(function () {
  const HOST_NAME = "nvimview";
  const MAX_HTTP_SNAPSHOT_BYTES = 512 * 1024;
  const HTTP_SNAPSHOT_TIMEOUT_MS = 10000;
  const SAMPLE_BYTES = 64 * 1024;
  const SESSION_TTL_MS = 5 * 60 * 1000;
  const MAIN_FRAME_FILTER = {
    urls: ["http://*/*", "https://*/*"],
    types: ["main_frame"],
  };

  async function getSettings() {
    const stored = await browser.storage.sync.get("settings");
    if (!stored.settings) {
      return globalThis.NvimView.getDefaultSettings();
    }
    return globalThis.NvimView.importSettings(JSON.stringify(stored.settings));
  }

  function sessionKey(sessionId) {
    return `session:${sessionId}`;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function charsetFromContentType(contentType) {
    const match = /charset=([^;]+)/i.exec(contentType || "");
    return match ? match[1].trim().replace(/^"|"$/g, "") : "utf-8";
  }

  function decodeSample(buffer, contentType) {
    const bytes = new Uint8Array(buffer.slice(0, SAMPLE_BYTES));
    try {
      return new TextDecoder(charsetFromContentType(contentType)).decode(bytes);
    } catch {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
  }

  function utf8Bytes(text) {
    return new TextEncoder().encode(text || "");
  }

  function suggestedName(url, contentDisposition) {
    const headerName =
      globalThis.NvimView.filenameFromContentDisposition(contentDisposition);
    if (headerName) {
      return headerName;
    }
    const fallback = globalThis.NvimView.basenameFromUrl(url);
    return fallback || "snapshot.txt";
  }

  function oversizedSnapshotError() {
    return new Error("HTTP snapshot is larger than the configured limit.");
  }

  function snapshotTooLargeResult(error = oversizedSnapshotError()) {
    return {
      eligible: false,
      message: error.message,
      reason: "snapshot-too-large",
    };
  }

  function snapshotFromLoadedText({
    contentDisposition = "",
    mimeType = "",
    text = "",
    url,
  }) {
    const bytes = utf8Bytes(text);
    if (bytes.byteLength > MAX_HTTP_SNAPSHOT_BYTES) {
      throw oversizedSnapshotError();
    }
    return {
      contentDisposition,
      mimeType,
      sample: text.slice(0, SAMPLE_BYTES),
      snapshotBase64: bytesToBase64(bytes),
      suggestedName: suggestedName(url, contentDisposition),
    };
  }

  async function readResponseBytes(response, abortFetch) {
    const reader = response.body?.getReader?.();
    if (!reader) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_HTTP_SNAPSHOT_BYTES) {
        throw oversizedSnapshotError();
      }
      return new Uint8Array(buffer);
    }

    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      length += chunk.byteLength;
      if (length > MAX_HTTP_SNAPSHOT_BYTES) {
        abortFetch?.();
        await reader.cancel().catch(() => {});
        throw oversizedSnapshotError();
      }
      chunks.push(chunk);
    }

    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  function isAbortError(error) {
    return error?.name === "AbortError";
  }

  async function fetchSnapshot(url, { timeoutMs = HTTP_SNAPSHOT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timeoutId =
      timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      });
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_HTTP_SNAPSHOT_BYTES) {
        controller.abort();
        throw oversizedSnapshotError();
      }
      const contentType = response.headers.get("content-type") || "";
      const contentDisposition = response.headers.get("content-disposition") || "";
      const bytes = await readResponseBytes(response, () => controller.abort());
      return {
        contentDisposition,
        mimeType: contentType,
        sample: decodeSample(bytes, contentType),
        snapshotBase64: bytesToBase64(bytes),
        suggestedName: suggestedName(url, contentDisposition),
      };
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }

  async function createSession(tabId, launch) {
    const url = await storeSession(launch);
    await browser.tabs.update(tabId, { url });
  }

  async function storeSession(launch) {
    const sessionId = crypto.randomUUID();
    await purgeExpiredSessions();
    await browser.storage.local.set({
      [sessionKey(sessionId)]: {
        createdAt: Date.now(),
        ...launch,
      },
    });
    return browser.runtime.getURL(`viewer/viewer.html?session=${sessionId}`);
  }

  async function purgeExpiredSessions(now = Date.now()) {
    const stored = await browser.storage.local.get(null);
    const expiredKeys = Object.entries(stored)
      .filter(
        ([key, value]) =>
          key.startsWith("session:") &&
          now - Number(value?.createdAt || 0) > SESSION_TTL_MS,
      )
      .map(([key]) => key);
    if (expiredKeys.length) {
      await browser.storage.local.remove(expiredKeys);
    }
  }

  function headerValue(responseHeaders, name) {
    const lowerName = name.toLowerCase();
    return (
      responseHeaders?.find((header) => header.name.toLowerCase() === lowerName)
        ?.value || ""
    );
  }

  function metadataFromHeaders(details) {
    return {
      contentDisposition: headerValue(details.responseHeaders, "content-disposition"),
      mimeType: headerValue(details.responseHeaders, "content-type"),
      sample: "",
    };
  }

  function isHttpUrl(url) {
    return url.startsWith("http://") || url.startsWith("https://");
  }

  function buildLaunch({ activation, settings, snapshot, url }) {
    return {
      fileUrl: activation.sourceKind === "local" ? url : "",
      startupCommand: settings.viewer.startupCommandEnabled
        ? settings.viewer.startupCommand
        : "",
      nvimExecutable: settings.neovim.executable,
      nvimFiletype: activation.nvimFiletype,
      readOnly: activation.sourceKind === "snapshot",
      settings: {
        fontFamily: settings.viewer.fontFamily,
        fontSizePx: settings.viewer.fontSizePx,
        cursorBlink: settings.viewer.cursorBlink,
        renderer: settings.viewer.renderer,
        zoomPercent: settings.viewer.zoomPercent,
      },
      mouseMode: settings.viewer.mouseMode,
      projectRootMarkers: settings.viewer.projectRootMarkers,
      sourceKind: activation.sourceKind,
      suggestedName:
        snapshot?.suggestedName || globalThis.NvimView.basenameFromUrl(url),
      snapshotBase64: snapshot?.snapshotBase64,
      url,
    };
  }

  function shouldStopBeforeSnapshot(result) {
    return (
      !result.eligible &&
      [
        "unsupported-scheme",
        "denied-url",
        "not-allowed-url",
        "html-page",
        "binary-sample",
      ].includes(result.reason)
    );
  }

  async function activationFromMetadata({
    loadedSnapshot = null,
    metadata,
    settings,
    url,
  }) {
    const initial = globalThis.NvimView.evaluateActivation({
      ...metadata,
      settings,
      url,
    });
    if (shouldStopBeforeSnapshot(initial)) {
      return { activation: initial, snapshot: null };
    }

    let snapshot = null;
    let activation = initial;
    if (isHttpUrl(url) && initial.eligible) {
      if (loadedSnapshot) {
        snapshot = loadedSnapshot;
      } else {
        try {
          snapshot = await fetchSnapshot(url);
        } catch (error) {
          if (isAbortError(error)) {
            return {
              activation: { eligible: false, reason: "snapshot-timeout" },
              snapshot: null,
            };
          }
          throw error;
        }
      }
      activation = globalThis.NvimView.evaluateActivation({
        ...snapshot,
        settings,
        url,
      });
    }
    return { activation, snapshot };
  }

  async function maybeRedirectFromHeaders(details) {
    if (
      typeof details.statusCode === "number" &&
      (details.statusCode < 200 || details.statusCode >= 300)
    ) {
      return {};
    }
    const settings = await getSettings();
    if (!settings.enabled) {
      return {};
    }
    const { activation, snapshot } = await activationFromMetadata({
      metadata: metadataFromHeaders(details),
      settings,
      url: details.url,
    });
    if (!activation.eligible) {
      return {};
    }
    const redirectUrl = await storeSession(
      buildLaunch({ activation, settings, snapshot, url: details.url }),
    );
    return { redirectUrl };
  }

  async function maybeOpen(sender, message) {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      return { eligible: false, reason: "missing-tab" };
    }

    const settings = await getSettings();
    if (!settings.enabled) {
      return { eligible: false, reason: "disabled" };
    }

    let metadata = {
      contentDisposition: "",
      mimeType: message.mimeType || "",
      sample: message.sample || "",
    };
    if (message.pageTextOversized) {
      return snapshotTooLargeResult();
    }
    let loadedSnapshot = null;
    if (isHttpUrl(message.url) && typeof message.pageText === "string") {
      try {
        loadedSnapshot = snapshotFromLoadedText({
          contentDisposition: metadata.contentDisposition,
          mimeType: metadata.mimeType,
          text: message.pageText,
          url: message.url,
        });
      } catch (error) {
        return snapshotTooLargeResult(error);
      }
    }
    const { activation, snapshot } = await activationFromMetadata({
      loadedSnapshot,
      metadata,
      settings,
      url: message.url,
    });
    if (!activation.eligible) {
      return activation;
    }

    await createSession(
      tabId,
      buildLaunch({ activation, settings, snapshot, url: message.url }),
    );
    return { eligible: true };
  }

  if (browser.webRequest?.onHeadersReceived) {
    browser.webRequest.onHeadersReceived.addListener(
      (details) => maybeRedirectFromHeaders(details).catch(() => ({})),
      MAIN_FRAME_FILTER,
      ["blocking", "responseHeaders"],
    );
  }

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "nvimview.maybeOpen") {
      return false;
    }
    return maybeOpen(sender, message).catch((error) => ({
      eligible: false,
      reason: "error",
      message: error.message,
    }));
  });

  browser.action.onClicked.addListener(() => {
    browser.runtime.openOptionsPage();
  });

  globalThis.NvimView = {
    ...(globalThis.NvimView || {}),
    HOST_NAME,
    HTTP_SNAPSHOT_TIMEOUT_MS,
    MAX_HTTP_SNAPSHOT_BYTES,
    fetchSnapshot,
    headerValue,
    maybeOpen,
    maybeRedirectFromHeaders,
    metadataFromHeaders,
    purgeExpiredSessions,
    snapshotFromLoadedText,
  };
})();
