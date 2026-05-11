(function () {
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

  async function maybeOpen() {
    if (!isTopFrame() || !isRawLikeDocument()) {
      return;
    }
    const sample = (document.body?.innerText || "").slice(0, SAMPLE_CHARS);
    await browser.runtime.sendMessage({
      type: "nvimview.maybeOpen",
      mimeType: document.contentType || "",
      sample,
      url: location.href,
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
