(function () {
  const HOST_NAME = "nvimview";
  const MAX_SYNC_SETTINGS_BYTES = 7600;
  const CUSTOM_FILETYPE_EXAMPLE = `[
  {
    "id": "python",
    "label": "Python",
    "nvimFiletype": "python",
    "extensions": ["py", "pyi"],
    "mimeTypes": ["text/x-python"],
    "shebangs": ["python", "python3"]
  }
]`;
  const state = {
    settings: globalThis.NvimView.getDefaultSettings(),
  };

  const $ = (id) => document.getElementById(id);

  function ruleToText(rule) {
    return rule.kind === "urlContains" ? `url:${rule.pattern}` : rule.pattern;
  }

  function textToRules(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) =>
        line.startsWith("url:")
          ? { kind: "urlContains", pattern: line.slice(4) }
          : { kind: "host", pattern: line },
      );
  }

  function parseCustomFileTypes() {
    const text = $("custom-filetypes").value.trim();
    if (!text) {
      return [];
    }
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("Custom file types must be a JSON array.");
    }
    return parsed.map(globalThis.NvimView.normalizeCustomDefinition);
  }

  function formatProjectRootMarkers(markers) {
    return markers.map((marker) => `${marker.strategy} ${marker.path}`).join("\n");
  }

  function parseProjectRootMarkers(text) {
    const markers = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = /^(highest|nearest)\s+(.+)$/i.exec(line);
        if (match) {
          return {
            strategy: match[1].toLowerCase(),
            path: match[2].trim(),
          };
        }
        return { strategy: "highest", path: line };
      });
    return markers.map(globalThis.NvimView.normalizeProjectRootMarker);
  }

  async function load() {
    await globalThis.NvimView.resetCurrentTabZoomToDefault({
      browserApi: browser,
    });
    const stored = await browser.storage.sync.get("settings");
    state.settings = stored.settings
      ? globalThis.NvimView.importSettings(JSON.stringify(stored.settings))
      : globalThis.NvimView.getDefaultSettings();
    render();
    renderPermissionDiagnostics();
  }

  async function renderPermissionDiagnostics() {
    if (!browser.extension?.isAllowedFileSchemeAccess) {
      $("file-url-access").textContent = "Check in Firefox add-on details";
      return;
    }
    const allowed = await browser.extension.isAllowedFileSchemeAccess();
    $("file-url-access").textContent = allowed ? "Allowed" : "Not allowed";
  }

  function renderFileTypes() {
    $("filetype-list").replaceChildren(
      ...globalThis.NvimView.allFileTypeDefinitions(state.settings).map(
        (definition) => {
          const label = document.createElement("label");
          label.className = "check-row";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.dataset.typeId = definition.id;
          checkbox.checked = state.settings.fileTypes.allowTypeIds.includes(
            definition.id,
          );
          label.append(checkbox, document.createTextNode(definition.label));
          return label;
        },
      ),
    );
  }

  function render() {
    $("enabled").checked = state.settings.enabled;
    $("deny-rules").value = state.settings.urlRules.deny.map(ruleToText).join("\n");
    $("allow-rules").value = state.settings.urlRules.allow.map(ruleToText).join("\n");
    $("nvim-executable").value = state.settings.neovim.executable;
    $("font-family").value = state.settings.viewer.fontFamily;
    $("font-size").value = state.settings.viewer.fontSizePx;
    $("cursor-blink").checked = state.settings.viewer.cursorBlink;
    $("viewer-mouse-mode").value = state.settings.viewer.mouseMode;
    $("viewer-renderer").value = state.settings.viewer.renderer;
    $("viewer-zoom").value = state.settings.viewer.zoomPercent;
    $("startup-command-enabled").checked = state.settings.viewer.startupCommandEnabled;
    $("startup-command").value = state.settings.viewer.startupCommand;
    $("project-root-markers").value = formatProjectRootMarkers(
      state.settings.viewer.projectRootMarkers,
    );
    $("custom-filetypes").value = globalThis.NvimView.formatCustomDefinitions(
      state.settings.fileTypes.customDefinitions,
    );
    $("custom-filetypes-sample").value = CUSTOM_FILETYPE_EXAMPLE;
    $("settings-json").value = globalThis.NvimView.exportSettings(state.settings);
    renderFileTypes();
  }

  function collect() {
    const customDefinitions = parseCustomFileTypes();
    const allowTypeIds = [
      ...document.querySelectorAll("input[data-type-id]:checked"),
    ].map((node) => node.dataset.typeId);

    state.settings = {
      ...state.settings,
      enabled: $("enabled").checked,
      fileTypes: {
        ...state.settings.fileTypes,
        allowTypeIds,
        customDefinitions,
      },
      neovim: {
        ...state.settings.neovim,
        executable: $("nvim-executable").value.trim(),
      },
      urlRules: {
        allow: textToRules($("allow-rules").value),
        deny: textToRules($("deny-rules").value),
      },
      viewer: {
        ...state.settings.viewer,
        fontFamily: $("font-family").value.trim(),
        fontSizePx: Number($("font-size").value),
        cursorBlink: $("cursor-blink").checked,
        mouseMode: $("viewer-mouse-mode").value,
        renderer: $("viewer-renderer").value,
        projectRootMarkers: parseProjectRootMarkers($("project-root-markers").value),
        startupCommand: $("startup-command").value.trim(),
        startupCommandEnabled: $("startup-command-enabled").checked,
        zoomPercent: Number($("viewer-zoom").value),
      },
    };
    globalThis.NvimView.validateSettings(state.settings);
  }

  function assertSyncSettingsSize(settings) {
    const bytes = new TextEncoder().encode(JSON.stringify({ settings })).byteLength;
    if (bytes > MAX_SYNC_SETTINGS_BYTES) {
      throw new Error(
        "Settings are too large for Firefox sync storage. Reduce custom rules or use export.",
      );
    }
  }

  async function save() {
    collect();
    assertSyncSettingsSize(state.settings);
    await browser.storage.sync.set({ settings: state.settings });
    $("status").textContent = "Saved";
    render();
  }

  $("select-all").addEventListener("click", () => {
    state.settings.fileTypes.allowTypeIds = globalThis.NvimView.allFileTypeDefinitions(
      state.settings,
    ).map((definition) => definition.id);
    render();
  });
  $("select-none").addEventListener("click", () => {
    state.settings.fileTypes.allowTypeIds = [];
    render();
  });
  $("save").addEventListener("click", () =>
    save().catch((error) => {
      $("status").textContent = error.message;
    }),
  );
  $("export-settings").addEventListener("click", () => {
    collect();
    $("settings-json").value = globalThis.NvimView.exportSettings(state.settings);
  });
  $("import-settings").addEventListener("click", () => {
    state.settings = globalThis.NvimView.importSettings($("settings-json").value);
    render();
  });
  $("restore-defaults").addEventListener("click", () => {
    state.settings = globalThis.NvimView.getDefaultSettings();
    render();
  });
  $("check-native-host").addEventListener("click", () => {
    try {
      collect();
      $("diagnostics-output").textContent = "Checking...";
      let answered = false;
      const port = browser.runtime.connectNative(HOST_NAME);
      port.onMessage.addListener((message) => {
        answered = true;
        $("diagnostics-output").textContent = JSON.stringify(message, null, 2);
        port.disconnect();
      });
      port.onDisconnect.addListener(() => {
        if (!answered) {
          $("diagnostics-output").textContent =
            browser.runtime.lastError?.message || "Native host disconnected.";
        }
      });
      port.postMessage({
        type: "diagnostics",
        nvimExecutable: state.settings.neovim.executable,
      });
    } catch (error) {
      $("diagnostics-output").textContent = error.message;
    }
  });

  load().catch((error) => {
    $("status").textContent = error.message;
  });
})();
