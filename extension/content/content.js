(function () {
  const MAX_HTTP_SNAPSHOT_BYTES = 512 * 1024;
  const SAMPLE_CHARS = 64 * 1024;

  function isTopFrame() {
    return window.top === window;
  }

  function isRawLikeDocument() {
    const contentType = (document.contentType || "").split(";")[0].toLowerCase();
    if (location.protocol === "file:") {
      return true;
    }
    if (contentType.startsWith("text/") && contentType !== "text/html") {
      return true;
    }
    const children = [...(document.body?.children || [])];
    return children.length === 1 && children[0].tagName === "PRE";
  }

  function rawText() {
    const children = [...(document.body?.children || [])];
    if (children.length === 1 && children[0].tagName === "PRE") {
      return children[0].textContent || "";
    }
    return document.body?.textContent || "";
  }

  function loadedSnapshotPayload(text) {
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      return {};
    }
    if (new TextEncoder().encode(text).byteLength > MAX_HTTP_SNAPSHOT_BYTES) {
      return { pageTextOversized: true };
    }
    return { pageText: text };
  }

  async function maybeOpen() {
    if (!isTopFrame() || !isRawLikeDocument()) {
      return;
    }
    const text = rawText();
    await browser.runtime.sendMessage({
      type: "nvimview.maybeOpen",
      mimeType: document.contentType || "",
      sample: text.slice(0, SAMPLE_CHARS),
      url: location.href,
      ...loadedSnapshotPayload(text),
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => maybeOpen().catch(() => {}), {
      once: true,
    });
  } else {
    maybeOpen().catch(() => {});
  }
})();
