(function () {
  const MAX_PENDING_FRAGMENTS = 16;

  class FragmentReassembler {
    constructor(maxPendingFragments = MAX_PENDING_FRAGMENTS) {
      this.pending = new Map();
      this.maxPendingFragments = maxPendingFragments;
    }

    evictOldestIfNeeded(fragmentId) {
      if (
        this.pending.has(fragmentId) ||
        this.pending.size < this.maxPendingFragments
      ) {
        return;
      }
      const oldestKey = this.pending.keys().next().value;
      this.pending.delete(oldestKey);
    }

    add(message) {
      if (message.type !== "fragment") {
        return message;
      }
      this.evictOldestIfNeeded(message.fragmentId);
      const items = this.pending.get(message.fragmentId) || [];
      items[message.index] = message;
      this.pending.set(message.fragmentId, items);
      if (items.filter(Boolean).length !== message.count) {
        return null;
      }
      this.pending.delete(message.fragmentId);
      const text = items.map((item) => atob(item.payloadBase64)).join("");
      const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0));
      return JSON.parse(new TextDecoder("utf-8").decode(bytes));
    }
  }

  function decodeBase64Bytes(value) {
    const binary = atob(value || "");
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  function encodeBinaryString(value) {
    let binary = "";
    for (let index = 0; index < value.length; index += 1) {
      binary += String.fromCharCode(value.charCodeAt(index) & 0xff);
    }
    return btoa(binary);
  }

  function createTerminalOptions(settings = {}) {
    return {
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: Boolean(settings.cursorBlink),
      customGlyphs: true,
      drawBoldTextInBrightColors: true,
      fontFamily: settings.fontFamily || "monospace",
      fontSize: settings.fontSizePx || 20,
      lineHeight: 1,
      altClickMovesCursor: false,
      macOptionClickForcesSelection: true,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      scrollback: 0,
      windowOptions: {
        setWinSizeChars: true,
      },
    };
  }

  function cursorStyleFromCode(code) {
    if (code === 3 || code === 4) {
      return "underline";
    }
    if (code === 5 || code === 6) {
      return "bar";
    }
    return "block";
  }

  function csiParamValues(params) {
    const values = Array.isArray(params) ? params : params?.params || [];
    return values.flatMap((value) => (Array.isArray(value) ? value : [value]));
  }

  function setSteadyCursor(terminal, cursorStyle) {
    if (cursorStyle) {
      terminal.options.cursorStyle = cursorStyle;
    }
    terminal.options.cursorBlink = false;
  }

  function allParamsAreCursorBlinkMode(params) {
    const values = csiParamValues(params);
    return values.length > 0 && values.every((value) => Number(value) === 12);
  }

  function installCursorStyleHandler(terminal, settings = {}) {
    if (settings.cursorBlink || !terminal?.parser?.registerCsiHandler) {
      return null;
    }
    const disposables = [
      terminal.parser.registerCsiHandler(
        { intermediates: " ", final: "q" },
        (params) => {
          const values = csiParamValues(params);
          const raw = Number(values[0] ?? 1);
          if (raw === 0) {
            terminal.options.cursorStyle = undefined;
            terminal.options.cursorBlink = false;
            return true;
          }
          setSteadyCursor(terminal, cursorStyleFromCode(raw));
          return true;
        },
      ),
      terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
        if (!allParamsAreCursorBlinkMode(params)) {
          return false;
        }
        setSteadyCursor(terminal);
        return true;
      }),
      terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
        if (!allParamsAreCursorBlinkMode(params)) {
          return false;
        }
        setSteadyCursor(terminal);
        return true;
      }),
    ];
    return {
      dispose() {
        for (const disposable of disposables) {
          disposable?.dispose?.();
        }
      },
    };
  }

  globalThis.NvimView = {
    ...(globalThis.NvimView || {}),
    createTerminalOptions,
    decodeBase64Bytes,
    encodeBinaryString,
    FragmentReassembler,
    installCursorStyleHandler,
  };
})();
