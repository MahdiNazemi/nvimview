# NvimView Architecture

## Purpose

NvimView opens eligible top-level local and HTTP(S) source files from Firefox in a
full-tab local Neovim session. Local files open writable by default. HTTP(S) files open
as read-only local snapshots unless a separate export workflow is added.

## Principles

- Only top-level navigations are eligible. Page subresources, iframes, scripts,
  stylesheets, images, fonts, XHR, and fetch requests must not activate the extension.
- Activation is allowlist-first. Users can remove built-in file types, add custom file
  types, and add URL allow or deny rules without editing Neovim configuration.
- Activation must not rely only on URL extensions. MIME type, response headers, local
  paths, known filenames, and bounded content hints all contribute.
- File types unchecked by default remain browser-owned unless the user enables them.
- Local files should behave like opening the same file in terminal Neovim.
- The viewer should preserve terminal Neovim behavior. Mappings, modes, colors, cursor
  shape, plugin redraws, smooth scrolling, counts, macros, and registers belong to
  Neovim, not browser JavaScript.
- Public defaults and documentation must stay generic.

## Components

- `extension/`: Manifest V3 WebExtension source, including background activation,
  content checks, the full-tab viewer, options UI, icons, and vendored browser assets.
- `native_host/`: Python native messaging host and host-side tests.
- `scripts/`: install, uninstall, vendoring, packaging, and smoke-test helpers.
- `tests/`: JavaScript tests for extension-side contracts.
- `docs/`: supporting references that are useful during development but are not runtime
  contracts.

Runtime is one Firefox viewer tab, one native messaging port, one Python native host,
and one Neovim process per opened file.

## Activation

The activation pipeline is:

1. Observe main-frame `http://` and `https://` response headers.
2. Let the content script confirm raw text-like pages, including `file://` pages and
   HTTP(S) cases where headers are inconclusive.
3. Apply URL allow and deny rules before content snapshots or native host work.
4. Evaluate built-in and custom filetype rules from metadata and bounded samples.
5. Store a short-lived viewer session in extension local storage.
6. Navigate the tab to the extension-owned viewer page.
7. Start the native host and launch Neovim for that session.

The detector separates activation from Neovim filetype selection. When detection knows
the filetype, the native host sets it explicitly in Neovim. If detection is
inconclusive, the extension does not activate.

## Filetype Rules

Built-in and custom filetype definitions can match:

- MIME types.
- Filename extensions.
- Exact filenames.
- Shebang hints.
- Bounded content hints.

Custom filetype definitions are structured settings. Each definition needs an ID, label,
Neovim filetype, and at least one matcher. Custom definitions participate in the same
allowlist and validation path as built-in definitions.

## Viewer

The viewer page is a terminal emulator, not a Neovim screen renderer. It uses xterm.js
with the fit addon and WebGL renderer by default, with a built-in renderer fallback in
settings. The native host starts Neovim as a normal TUI in a pseudo-terminal, forwards
PTY bytes to the viewer, and forwards xterm.js input bytes back to the PTY.

Interactive input must stay on the PTY path. Browser JavaScript must not interpret
multi-key editor sequences such as `dd`, `C`, `daw`, `3j`, `gg`, `gqap`, or user
mappings.

Viewer defaults:

- Font family from settings, defaulting to a Meslo-compatible monospace stack.
- Font size from settings, defaulting to `20px`.
- Mouse behavior from settings, defaulting to browser selection mode. In that mode the
  native session clears Neovim mouse reporting so drag selection and copy-on-select
  remain browser-native. A Neovim mouse mode preserves the user's configured `mouse`
  option instead.
- Renderer from settings, defaulting to xterm.js WebGL.
- Browser zoom percent from settings, defaulting to `100`.
- Zero xterm.js scrollback because Neovim owns the alternate screen.
- No fixed xterm.js color theme.
- No fixed xterm.js cursor shape. Cursor blink defaults off in the viewer; when it is
  off, cursor-shape requests are mapped to the same steady block, beam, or underline
  shape.
- Cursor color and cursor accent are derived from Neovim's active `Cursor` and `Normal`
  highlights when available. They are synchronized at startup and after colorscheme
  changes.
- Copy-on-select when clipboard permission is available.

The viewer page is the only page where the extension applies configured browser zoom. It
uses `tabs.setZoom()` only. Other extension pages reset their current tab with
`tabs.setZoom(tabId, 0)` so Firefox applies the user's browser default zoom. The
extension does not call `tabs.setZoomSettings()` because Firefox support is uneven and
live testing rejected otherwise reasonable zoom-setting combinations.

## Neovim Session

Each viewer tab owns one native host process and one Neovim process. Closing the tab or
disconnecting the native messaging port tears down the process group.

Neovim owns editor layout. NvimView can run an optional user-configured startup command
after opening the target file, then returns focus to the target file if the command
created other windows. The extension does not implement or resize editor sidebars. If a
startup command opens panes, user Neovim configuration owns pane width, statuslines, and
`VimResized` behavior.

Root marker lookup walks upward from the opened file and stops before the user's home
directory. Defaults are highest `.git`, highest `AGENTS.md`, highest `CLAUDE.md`, and
highest `.claude`. The resolved root becomes Neovim's working directory; if no marker
matches, the file directory is used.

## Local Files

For `file://` navigations:

- Firefox file URL access is required.
- Activation uses the content-script path because blocking response-header redirects are
  HTTP(S)-only.
- The native host opens the real local path.
- Writable mode is enabled by default.
- The native host passes an explicit filetype when detection knows one.

## HTTP(S) Files

For HTTP(S) navigations:

- Matching resources open as read-only snapshots by default.
- The extension fetches bounded content using browser credentials.
- Snapshot fetches are bounded by size and timeout. Timeout leaves the original browser
  navigation alone.
- The native host writes the snapshot into an extension-owned temp directory.
- The temp filename is derived from content disposition, URL basename, MIME type, or
  detected filetype.
- Closing a read-only snapshot does not warn about unsaved changes.

Saving remote snapshots is not an HTTP upload. Any export or write-back workflow needs
its own design.

## Native Host

The Python native host owns local system interaction:

- Speak the native messaging protocol over stdin/stdout.
- Discover or use the configured Neovim executable.
- Start Neovim as a TUI in a PTY.
- Start Neovim with a session-local RPC socket for lifecycle and status tasks.
- Forward PTY output to the viewer as base64 payloads.
- Forward viewer input bytes to the PTY.
- Resize the PTY and signal Neovim on viewer resize.
- Resolve local paths from `file://` URLs.
- Create and clean temp files for HTTP(S) snapshots.
- Set cwd, read-only mode, filetype, and optional startup command.
- Track opened-file dirty state without blocking interactive input.
- Terminate the Neovim process group when the tab closes or the viewer disconnects.

RPC must not sit on the interactive key path. It is reserved for bounded lifecycle and
status operations.

## Dirty State

Dirty-state tracking applies only to the file opened for the viewer session. The native
host installs a session-local Neovim hook that emits opened-file dirty state on buffer
events and mirrors that state to a temp file. Viewer dirty status is event-driven during
normal editing, and explicit dirty-status requests read the temp file instead of
synchronously querying Neovim.

Local writable files:

- Closing the tab with a modified opened file should trigger a browser close warning.
- If the user stays, Neovim remains alive.
- If the user leaves, changes are discarded and Neovim is terminated.

HTTP(S) read-only snapshots:

- No save prompt.
- No browser close warning.
- Temp files are removed when the session closes.

## Settings

Settings are stored in Firefox sync storage when they are small and safe to sync.
Short-lived viewer sessions and captured snapshots use local storage.

Required settings support:

- Source-controlled defaults.
- Validation before import.
- Export and import.
- Restore defaults.
- General enablement.
- Built-in filetype checklist and custom filetypes.
- URL allow and deny rules.
- Neovim executable path.
- Optional Neovim startup command.
- Project root markers.
- Viewer font family, font size, renderer, mouse mode, cursor blink, and zoom percent.
- Native host diagnostics.

## Permissions

Required Firefox permissions:

- `nativeMessaging`.
- `storage`.
- `tabs`.
- `clipboardWrite`.
- `webRequest` and `webRequestBlocking`.
- Host permissions for `file:///*`, `http://*/*`, and `https://*/*`.

The options page should show clear diagnostics when file URL access, host access, or the
native messaging host is missing.

## Safety

- File content must not be sent to network services.
- Viewer pages must use a content security policy that forbids remote scripts and inline
  scripts.
- Neovim launch uses argv arrays. URL-derived strings must not pass through a shell.
- Native host communication with the browser uses stdin/stdout only.
- Local RPC sockets live in session-local temp directories and are removed on close.
- HTTP(S) snapshots are local, temporary, and read-only by default.
- Domain and URL deny rules must prevent launch before native host work.
- Telemetry and crash reporting are off unless the user explicitly opts in.

## Verification Contracts

The implementation should remain mechanically verifiable. Tests and smoke checks should
prove at least these contracts:

- Activation applies only to eligible top-level navigations.
- Interactive editor input travels through the PTY.
- Local files, HTTP(S) snapshots, optional startup command, dirty-state handling, and
  process cleanup match the contracts above.
- Public docs and defaults remain generic.

## References

- xterm.js provides the browser terminal renderer.
- Firenvim is useful prior art for browser-to-Neovim integration.
- Tachi Code is useful prior art for source-file activation from browser navigations.
