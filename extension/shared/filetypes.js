(function () {
  const TEXT_MIME_TYPES = new Set(["application/octet-stream", "text/plain"]);

  function normalizedMime(mimeType) {
    return (mimeType || "").split(";")[0].trim().toLowerCase();
  }

  function basenameFromUrl(url) {
    try {
      const parsed = new URL(url);
      const pathname = decodeURIComponent(parsed.pathname);
      return pathname.split("/").filter(Boolean).pop() || "";
    } catch {
      return "";
    }
  }

  function extensionFromName(name) {
    const clean = (name || "").split(/[?#]/)[0];
    const last = clean.split("/").pop() || "";
    const index = last.lastIndexOf(".");
    if (index < 0 || index === last.length - 1) {
      return "";
    }
    return last.slice(index + 1).toLowerCase();
  }

  function filenameFromContentDisposition(value) {
    const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(value || "");
    if (!match) {
      return "";
    }
    return decodeURIComponent(match[1].replace(/^"|"$/g, ""));
  }

  function looksBinary(sample) {
    if (!sample) {
      return false;
    }
    return sample.includes("\u0000");
  }

  function shebangCommand(sample) {
    const firstLine = (sample || "").split(/\r?\n/, 1)[0] || "";
    if (!firstLine.startsWith("#!")) {
      return "";
    }
    return firstLine.slice(2).trim().split("/").pop() || "";
  }

  function definitionById(id, settings = null) {
    return globalThis.NvimView.allFileTypeDefinitions(settings).find(
      (entry) => entry.id === id,
    );
  }

  function matchDefinition({ url, mimeType, sample, contentDisposition, settings }) {
    const mime = normalizedMime(mimeType);
    const dispositionName = filenameFromContentDisposition(contentDisposition);
    const basename = dispositionName || basenameFromUrl(url);
    const extension = extensionFromName(basename);
    const filename = basename.replace(/\.[^.]+$/, "");
    const shebang = shebangCommand(sample);

    for (const definition of globalThis.NvimView.allFileTypeDefinitions(settings)) {
      if ((definition.mimeTypes || []).includes(mime)) {
        return definition;
      }
      if (extension && (definition.extensions || []).includes(extension)) {
        return definition;
      }
      if ((definition.filenames || []).includes(filename)) {
        return definition;
      }
      if (
        shebang &&
        (definition.shebangs || []).some((item) => shebang.includes(item))
      ) {
        return definition;
      }
    }
    return null;
  }

  function detectFileType({
    url,
    mimeType,
    sample = "",
    contentDisposition = "",
    settings,
  }) {
    const mime = normalizedMime(mimeType);
    const activeSettings = settings || globalThis.NvimView.getDefaultSettings();
    const definition = matchDefinition({
      contentDisposition,
      mimeType,
      sample,
      settings: activeSettings,
      url,
    });

    if (looksBinary(sample)) {
      return { eligible: false, reason: "binary-sample" };
    }
    if (mime === "text/html") {
      return { eligible: false, reason: "html-page" };
    }
    if (!definition) {
      return { eligible: false, reason: "unknown-filetype" };
    }
    if (activeSettings.fileTypes?.denyTypeIds?.includes(definition.id)) {
      return { eligible: false, id: definition.id, reason: "denied-filetype" };
    }
    if (!activeSettings.fileTypes?.allowTypeIds?.includes(definition.id)) {
      return { eligible: false, id: definition.id, reason: "not-allowed" };
    }

    return {
      eligible: true,
      id: definition.id,
      label: definition.label,
      nvimFiletype: definition.nvimFiletype,
    };
  }

  function isProbablyTextMime(mimeType) {
    const mime = normalizedMime(mimeType);
    return mime.startsWith("text/") || TEXT_MIME_TYPES.has(mime);
  }

  globalThis.NvimView = {
    ...(globalThis.NvimView || {}),
    basenameFromUrl,
    definitionById,
    detectFileType,
    extensionFromName,
    filenameFromContentDisposition,
    isProbablyTextMime,
    normalizedMime,
  };
})();
