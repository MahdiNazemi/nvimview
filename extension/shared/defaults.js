(function () {
  const DEFAULT_FONT_FAMILY =
    '"MesloLGS NF", "Meslo LGS NF", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

  const FILE_TYPE_DEFINITIONS = [
    {
      id: "markdown",
      label: "Markdown",
      nvimFiletype: "markdown",
      extensions: ["md", "markdown", "mdown", "mkd"],
      mimeTypes: ["text/markdown", "text/x-markdown"],
      filenames: ["README", "CHANGELOG", "CONTRIBUTING"],
    },
    {
      id: "python",
      label: "Python",
      nvimFiletype: "python",
      extensions: ["py", "pyi", "pyw"],
      mimeTypes: ["text/x-python", "application/x-python-code"],
      shebangs: ["python", "python3"],
    },
    {
      id: "javascript",
      label: "JavaScript",
      nvimFiletype: "javascript",
      extensions: ["js", "mjs", "cjs"],
      mimeTypes: ["text/javascript", "application/javascript"],
    },
    {
      id: "typescript",
      label: "TypeScript",
      nvimFiletype: "typescript",
      extensions: ["ts", "tsx", "mts", "cts"],
      mimeTypes: ["text/typescript", "application/typescript"],
    },
    {
      id: "shell",
      label: "Shell",
      nvimFiletype: "sh",
      extensions: ["sh", "bash", "zsh", "ksh"],
      mimeTypes: ["text/x-shellscript"],
      shebangs: ["bash", "zsh", "sh", "env bash", "env zsh", "env sh"],
    },
    {
      id: "yaml",
      label: "YAML",
      nvimFiletype: "yaml",
      extensions: ["yaml", "yml"],
      mimeTypes: ["application/yaml", "text/yaml", "text/x-yaml"],
    },
    {
      id: "toml",
      label: "TOML",
      nvimFiletype: "toml",
      extensions: ["toml"],
      mimeTypes: ["application/toml"],
    },
    {
      id: "rust",
      label: "Rust",
      nvimFiletype: "rust",
      extensions: ["rs"],
      mimeTypes: ["text/rust", "text/x-rust"],
    },
    {
      id: "go",
      label: "Go",
      nvimFiletype: "go",
      extensions: ["go"],
      mimeTypes: ["text/x-go"],
    },
    {
      id: "cpp",
      label: "C/C++",
      nvimFiletype: "cpp",
      extensions: ["c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"],
      mimeTypes: ["text/x-c", "text/x-c++src", "text/x-c++hdr"],
    },
    {
      id: "json",
      label: "JSON",
      nvimFiletype: "json",
      extensions: ["json", "jsonc"],
      mimeTypes: ["application/json", "application/manifest+json"],
      browserNativeDefault: true,
    },
    {
      id: "xml",
      label: "XML",
      nvimFiletype: "xml",
      extensions: ["xml"],
      mimeTypes: ["application/xml", "text/xml"],
      browserNativeDefault: true,
    },
    {
      id: "log",
      label: "Logs",
      nvimFiletype: "log",
      extensions: ["log", "txt"],
      mimeTypes: ["text/plain"],
    },
  ];

  const BROWSER_NATIVE_MIME_PREFIXES = ["image/"];

  const BROWSER_NATIVE_MIME_TYPES = [
    "application/json",
    "application/pdf",
    "application/xml",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/html",
    "text/xml",
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function allFileTypeDefinitions(settings = null) {
    const customDefinitions = settings?.fileTypes?.customDefinitions || [];
    return [...customDefinitions, ...FILE_TYPE_DEFINITIONS];
  }

  function getDefaultSettings() {
    const allowTypeIds = FILE_TYPE_DEFINITIONS.filter(
      (entry) => !entry.browserNativeDefault,
    ).map((entry) => entry.id);

    return {
      schemaVersion: 1,
      enabled: true,
      fileTypes: {
        allowTypeIds,
        customDefinitions: [],
        denyTypeIds: [],
      },
      urlRules: {
        allow: [],
        deny: [],
      },
      viewer: {
        fontFamily: DEFAULT_FONT_FAMILY,
        fontSizePx: 20,
        cursorBlink: false,
        mouseMode: "selection",
        renderer: "webgl",
        zoomPercent: 100,
        startupCommandEnabled: false,
        startupCommand: "",
        projectRootMarkers: [
          { path: ".git", strategy: "highest" },
          { path: "AGENTS.md", strategy: "highest" },
          { path: "CLAUDE.md", strategy: "highest" },
          { path: ".claude", strategy: "highest" },
        ],
      },
      neovim: {
        executable: "",
      },
    };
  }

  globalThis.NvimView = {
    ...(globalThis.NvimView || {}),
    DEFAULT_FONT_FAMILY,
    BROWSER_NATIVE_MIME_PREFIXES,
    BROWSER_NATIVE_MIME_TYPES,
    FILE_TYPE_DEFINITIONS,
    allFileTypeDefinitions,
    clone,
    getDefaultSettings,
  };
})();
