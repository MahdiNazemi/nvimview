(function () {
  function schemeOf(url) {
    if (url.startsWith("view-source:")) {
      return "view-source:";
    }
    try {
      return new URL(url).protocol;
    } catch {
      return "";
    }
  }

  function isSupportedTopLevelScheme(url) {
    return ["file:", "http:", "https:"].includes(schemeOf(url));
  }

  function evaluateActivation({
    url,
    mimeType,
    sample = "",
    contentDisposition = "",
    settings,
  }) {
    if (!isSupportedTopLevelScheme(url)) {
      return { eligible: false, reason: "unsupported-scheme" };
    }
    if (globalThis.NvimView.isUrlDenied(url, settings)) {
      return { eligible: false, reason: "denied-url" };
    }
    if (!globalThis.NvimView.isUrlAllowed(url, settings)) {
      return { eligible: false, reason: "not-allowed-url" };
    }

    const fileType = globalThis.NvimView.detectFileType({
      contentDisposition,
      mimeType,
      sample,
      settings,
      url,
    });
    if (!fileType.eligible) {
      return fileType;
    }
    return {
      ...fileType,
      sourceKind: schemeOf(url) === "file:" ? "local" : "snapshot",
    };
  }

  globalThis.NvimView = {
    ...(globalThis.NvimView || {}),
    evaluateActivation,
    isSupportedTopLevelScheme,
    schemeOf,
  };
})();
