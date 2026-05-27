# Agent Guidelines

These instructions apply to the whole repository.

## Project Shape

NvimView is a Firefox Manifest V3 extension that opens eligible top-level source files
in a local Neovim terminal session. The extension side decides whether a navigation is
eligible, the viewer renders a terminal with xterm.js, and the native host owns Neovim
process management.

Use these files as the durable references:

- `README.md`: installation, local testing, and user-facing behavior.
- `ARCHITECTURE.md`: product contracts and runtime design constraints.
- `CONTRIBUTING.md`: development setup, checks, hooks, and test scope.
- `SECURITY.md`: native-host, file access, and trust-boundary expectations.
- `ROADMAP.md`: deferred ideas that should not be mixed into focused changes.

## Directory Map

- `extension/`: WebExtension source.
- `extension/background/`: activation, session setup, and browser integration.
- `extension/content/`: page-level checks for raw text-like top-level documents.
- `extension/options/`: settings UI, schema, validation, import, and export.
- `extension/shared/`: shared defaults, filetype rules, URL rules, and browser helpers.
- `extension/viewer/`: full-tab terminal viewer and native-host session bridge.
- `extension/vendor/`: checked-in runtime browser assets required by the unpacked
  extension.
- `native_host/`: Python native messaging host, PTY handling, Neovim launch, and
  host-side helpers.
- `scripts/`: setup, install, packaging, vendoring, and smoke-test automation.
- `tests/`: JavaScript extension-side tests.
- `docs/`: durable supporting references.

## Maintenance Rules

- Keep repository documentation public-safe. Do not add private paths, personal workflow
  details, temporary debugging notes, or session history.
- Preserve the split between activation and editing. Browser code decides whether to
  open a viewer; Neovim owns editing behavior, mappings, modes, colors, cursor shape,
  panes, and redraws.
- Keep the xterm.js PTY path as the terminal rendering model unless the architecture
  document is deliberately changed first.
- Do not reintroduce a custom Neovim screen renderer without a new design review.
- Treat HTTP(S) files as read-only snapshots unless a write-back workflow is explicitly
  designed.
- Keep JSON, XML, PDF, SVG, images, and HTML browser-owned by default through filetype
  settings rather than one-off activation checks.
- When adding settings, update the schema, defaults, options UI, import/export behavior,
  and tests together.
- When adding filetype rules, keep browser-side and native-host detection behavior
  aligned.
- When changing native messaging protocol fields, update both extension and native-host
  tests.
- Avoid persistent logging in committed code. Temporary diagnostics should be removed
  before commit.
- Keep generated or local runtime artifacts out of git.

## Checks

Run the normal gate before sharing changes:

```sh
npm run format
npm run check
```

For changes touching the native host or Neovim launch behavior, also run the native-host
smoke script documented in `CONTRIBUTING.md`.

For changes touching xterm.js dependencies, refresh vendored assets with:

```sh
npm run vendor:xterm
```

Then run the full gate again.
