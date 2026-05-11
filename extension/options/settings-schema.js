(function () {
  const CUSTOM_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
  const NVIM_FILETYPE_PATTERN = /^[A-Za-z0-9_]+$/;
  const VIEWER_MOUSE_MODES = new Set(["selection", "neovim"]);
  const VIEWER_RENDERERS = new Set(["builtin", "webgl"]);
  const PROJECT_ROOT_MARKER_STRATEGIES = new Set(["highest", "nearest"]);

  function mergeDefaults(value, defaults) {
    if (Array.isArray(defaults)) {
      return Array.isArray(value) ? value : globalThis.NvimView.clone(defaults);
    }
    if (defaults && typeof defaults === "object") {
      const result = {};
      for (const [key, defaultValue] of Object.entries(defaults)) {
        result[key] = mergeDefaults(value?.[key], defaultValue);
      }
      return result;
    }
    return value === undefined ? defaults : value;
  }

  function stringList(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  function normalizeCustomDefinition(definition) {
    const id = String(definition?.id || "")
      .trim()
      .toLowerCase();
    const nvimFiletype = String(definition?.nvimFiletype || id).trim();
    if (!CUSTOM_ID_PATTERN.test(id)) {
      throw new Error(
        "Custom file type IDs may only contain letters, numbers, _, or -.",
      );
    }
    if (!NVIM_FILETYPE_PATTERN.test(nvimFiletype)) {
      throw new Error(
        "Custom Neovim filetypes may only contain letters, numbers, or _.",
      );
    }
    const normalized = {
      id,
      label: String(definition?.label || id).trim(),
      nvimFiletype,
      extensions: stringList(definition?.extensions).map((item) =>
        item.replace(/^\./, "").toLowerCase(),
      ),
      mimeTypes: stringList(definition?.mimeTypes).map((item) => item.toLowerCase()),
      filenames: stringList(definition?.filenames),
      shebangs: stringList(definition?.shebangs),
    };
    if (
      !normalized.extensions.length &&
      !normalized.mimeTypes.length &&
      !normalized.filenames.length &&
      !normalized.shebangs.length
    ) {
      throw new Error("Custom file types need at least one matcher.");
    }
    return normalized;
  }

  function normalizeProjectRootMarker(marker) {
    const path = String(marker?.path || "")
      .trim()
      .replace(/\/+$/g, "");
    const strategy = String(marker?.strategy || "highest")
      .trim()
      .toLowerCase();
    if (
      !path ||
      path.startsWith("/") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error("Project root markers must be relative paths.");
    }
    if (!PROJECT_ROOT_MARKER_STRATEGIES.has(strategy)) {
      throw new Error("Project root marker strategy must be highest or nearest.");
    }
    return {
      path,
      strategy,
    };
  }

  function normalizeProjectRootMarkers(markers) {
    const source = Array.isArray(markers)
      ? markers
      : globalThis.NvimView.getDefaultSettings().viewer.projectRootMarkers;
    const normalized = source.map(normalizeProjectRootMarker);
    return normalized.length
      ? normalized
      : globalThis.NvimView.getDefaultSettings().viewer.projectRootMarkers;
  }

  function normalizeSettings(settings) {
    const customDefinitions = (settings.fileTypes.customDefinitions || []).map(
      normalizeCustomDefinition,
    );
    const builtInIds = new Set(
      globalThis.NvimView.FILE_TYPE_DEFINITIONS.map((definition) => definition.id),
    );
    const seen = new Set(builtInIds);
    for (const definition of customDefinitions) {
      if (seen.has(definition.id)) {
        throw new Error(`Duplicate file type ID: ${definition.id}`);
      }
      seen.add(definition.id);
    }
    settings.fileTypes.customDefinitions = customDefinitions;
    settings.fileTypes.allowTypeIds = stringList(settings.fileTypes.allowTypeIds);
    settings.fileTypes.denyTypeIds = stringList(settings.fileTypes.denyTypeIds);
    settings.viewer.cursorBlink = Boolean(settings.viewer.cursorBlink);
    settings.viewer.mouseMode = String(settings.viewer.mouseMode || "selection").trim();
    settings.viewer.renderer = String(settings.viewer.renderer || "webgl").trim();
    settings.viewer.startupCommand = String(
      settings.viewer.startupCommand || "",
    ).trim();
    settings.viewer.startupCommandEnabled = Boolean(
      settings.viewer.startupCommandEnabled,
    );
    settings.viewer.projectRootMarkers = normalizeProjectRootMarkers(
      settings.viewer.projectRootMarkers,
    );
    return settings;
  }

  function formatCustomDefinitions(definitions) {
    if (!definitions?.length) {
      return "";
    }
    return `${JSON.stringify(definitions, null, 2)}\n`;
  }

  function validateSettings(settings) {
    settings = normalizeSettings(settings);
    if (settings.schemaVersion !== 1) {
      throw new Error("Unsupported settings schema version.");
    }
    if (!Number.isFinite(settings.viewer.fontSizePx)) {
      throw new Error("Viewer font size must be numeric.");
    }
    const zoom = settings.viewer.zoomPercent;
    if (!Number.isFinite(zoom) || zoom < 30 || zoom > 500) {
      throw new Error("Viewer zoom must be between 30 and 500 percent.");
    }
    if (!VIEWER_RENDERERS.has(settings.viewer.renderer)) {
      throw new Error("Viewer renderer must be builtin or webgl.");
    }
    if (!VIEWER_MOUSE_MODES.has(settings.viewer.mouseMode)) {
      throw new Error("Viewer mouse mode must be selection or neovim.");
    }
    return settings;
  }

  function importSettings(text) {
    const parsed = JSON.parse(text);
    const settings = mergeDefaults(parsed, globalThis.NvimView.getDefaultSettings());
    return validateSettings(settings);
  }

  function exportSettings(settings) {
    return `${JSON.stringify(validateSettings(settings), null, 2)}\n`;
  }

  globalThis.NvimView = {
    ...(globalThis.NvimView || {}),
    exportSettings,
    formatCustomDefinitions,
    importSettings,
    mergeDefaults,
    normalizeCustomDefinition,
    normalizeProjectRootMarker,
    validateSettings,
  };
})();
