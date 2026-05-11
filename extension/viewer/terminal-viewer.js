(function () {
  const HOST_NAME = "nvimview";
  const terminalNode = document.getElementById("terminal");
  const statusNode = document.getElementById("status");
  const toastNode = document.getElementById("toast");
  const reassembler = new globalThis.NvimView.FragmentReassembler();
  let port = null;
  let session = null;
  let terminal = null;
  let fitAddon = null;
  let dirty = false;
  let resizeFrame = null;
  let selectionDirty = false;
  let toastTimer = null;
  let viewerTabId = null;
  let resettingZoom = false;

  function setStatus(text, hidden = false) {
    statusNode.textContent = text;
    statusNode.dataset.hidden = hidden ? "true" : "false";
  }

  function showToast(text) {
    if (!toastNode) {
      return;
    }
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
    }
    toastNode.textContent = text;
    toastNode.dataset.visible = "true";
    toastTimer = setTimeout(() => {
      toastNode.dataset.visible = "false";
      toastTimer = null;
    }, 1100);
  }

  function sessionId() {
    return new URLSearchParams(location.search).get("session");
  }

  function sessionStorageKey(id) {
    return `session:${id}`;
  }

  async function loadSession() {
    const id = sessionId();
    if (!id) {
      throw new Error("Missing viewer session.");
    }
    const key = sessionStorageKey(id);
    const stored = await browser.storage.local.get(key);
    await browser.storage.local.remove(key);
    if (!stored[key]) {
      throw new Error("Viewer session expired; close this tab and reopen the file.");
    }
    return stored[key];
  }

  function postToHost(message) {
    if (!port) {
      setStatus("Native host is not connected.");
      return false;
    }
    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      port = null;
      setStatus(error.message || "Native host disconnected.");
      return false;
    }
  }

  function terminalSize() {
    return {
      cols: terminal?.cols || 120,
      rows: terminal?.rows || 40,
    };
  }

  function fitAndResize() {
    if (!terminal || !fitAddon) {
      return;
    }
    fitAddon.fit();
    if (port) {
      postToHost({ type: "resize", ...terminalSize() });
    }
  }

  function scheduleResize() {
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
    }
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      fitAndResize();
    });
  }

  function requestDirtyStatus() {
    if (port && !session?.readOnly) {
      postToHost({ type: "dirtyStatus" });
    }
  }

  async function copySelection() {
    const text = terminal?.getSelection() || "";
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      terminal?.clearSelection();
      showToast("Copied");
    } catch {
      setStatus("Could not copy selected text.");
    }
  }

  function copySelectionIfDirty() {
    if (!selectionDirty) {
      return;
    }
    selectionDirty = false;
    copySelection();
  }

  function createTerminal() {
    const TerminalCtor = globalThis.Terminal;
    const FitAddonCtor = globalThis.FitAddon?.FitAddon;
    const WebglAddonCtor = globalThis.WebglAddon?.WebglAddon;
    if (!TerminalCtor || !FitAddonCtor) {
      throw new Error("xterm.js did not load.");
    }

    terminal = new TerminalCtor(
      globalThis.NvimView.createTerminalOptions(session?.settings),
    );
    globalThis.NvimView.installCursorStyleHandler(terminal, session?.settings);
    fitAddon = new FitAddonCtor();
    terminal.loadAddon(fitAddon);
    if (session?.settings?.renderer === "webgl" && WebglAddonCtor) {
      try {
        terminal.loadAddon(new WebglAddonCtor());
      } catch {
        setStatus("WebGL renderer unavailable; using xterm.js fallback.");
      }
    }
    terminal.open(terminalNode);
    terminal.focus();
    fitAddon.fit();

    terminal.onData((data) => {
      postToHost({ type: "terminalInput", data });
    });
    terminal.onBinary((data) => {
      postToHost({
        type: "terminalInputBase64",
        dataBase64: globalThis.NvimView.encodeBinaryString(data),
      });
    });
    terminal.onSelectionChange(() => {
      selectionDirty = true;
    });
  }

  function sendLaunch() {
    setStatus("Starting Neovim...");
    postToHost({
      type: "launch",
      ...session,
      ...terminalSize(),
    });
  }

  async function enforceZoom() {
    if (resettingZoom) {
      return;
    }
    resettingZoom = true;
    try {
      viewerTabId = await globalThis.NvimView.enforceViewerZoom({
        browserApi: browser,
        zoomPercent: session?.settings?.zoomPercent,
      });
    } finally {
      resettingZoom = false;
    }
  }

  function targetZoomFactor() {
    return globalThis.NvimView.zoomFactorFromPercent(session?.settings?.zoomPercent);
  }

  function handleHostMessage(raw) {
    const message = reassembler.add(raw);
    if (!message) {
      return;
    }
    if (message.type === "ready") {
      setStatus("Neovim ready", true);
      fitAndResize();
      requestDirtyStatus();
      return;
    }
    if (message.type === "terminalOutput") {
      terminal?.write(globalThis.NvimView.decodeBase64Bytes(message.dataBase64));
      return;
    }
    if (message.type === "dirtyStatus") {
      dirty = Boolean(message.dirty);
      return;
    }
    if (message.type === "terminalTheme") {
      terminal.options.theme = {
        ...(terminal.options.theme || {}),
        ...message.theme,
      };
      return;
    }
    if (message.type === "error") {
      setStatus(message.message || "Native host error.");
      return;
    }
    if (message.type === "exit") {
      setStatus("Neovim exited.");
    }
  }

  async function start() {
    session = await loadSession();
    await enforceZoom();
    await document.fonts?.ready;
    createTerminal();
    port = browser.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener(handleHostMessage);
    port.onDisconnect.addListener(() => {
      const error =
        port?.error?.message ||
        browser.runtime.lastError?.message ||
        globalThis.chrome?.runtime?.lastError?.message ||
        "";
      setStatus(
        error ? `Native host disconnected: ${error}` : "Native host disconnected.",
      );
      port = null;
    });
    sendLaunch();
  }

  window.addEventListener("resize", scheduleResize);
  document.addEventListener("mouseup", copySelectionIfDirty);
  document.addEventListener("pointerup", copySelectionIfDirty);
  if (browser.tabs?.onZoomChange) {
    browser.tabs.onZoomChange.addListener((changeInfo) => {
      if (
        typeof viewerTabId === "number" &&
        changeInfo.tabId === viewerTabId &&
        Math.abs(changeInfo.newZoomFactor - targetZoomFactor()) > 0.001
      ) {
        enforceZoom().then(scheduleResize, () => {});
      }
    });
  }
  if (globalThis.ResizeObserver) {
    new ResizeObserver(scheduleResize).observe(terminalNode);
  }
  window.addEventListener("beforeunload", (event) => {
    if (dirty && !session?.readOnly) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => {
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
    }
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (port) {
      postToHost({ type: "close" });
      port.disconnect();
      port = null;
    }
  });
  window.addEventListener("error", (event) => {
    setStatus(event.message || "Viewer script error.");
  });
  window.addEventListener("unhandledrejection", (event) => {
    setStatus(event.reason?.message || "Viewer promise rejected.");
  });

  start().catch((error) => setStatus(error.message));
})();
