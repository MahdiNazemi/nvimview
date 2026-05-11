# Contributing

## Documentation Roles

- `ARCHITECTURE.md` describes durable product and runtime decisions.
- `README.md` should cover installation, local testing, and normal use.
- `CONTRIBUTING.md` owns development setup, formatting, checks, and workflow notes.
- `ROADMAP.md` tracks deferred product ideas.
- `docs/prior-art.md` records references that informed design without implying copied
  source.

Avoid putting session history, private examples, or brainstorming notes in repository
docs. When a design changes, update the durable constraint and let git history carry the
timeline.

## Development Setup

Install the JavaScript tooling:

```sh
npm install
```

Create the native-host Python environment:

```sh
scripts/bootstrap_native_host.sh
```

Install the Firefox native messaging manifest for local testing:

```sh
scripts/install_native_host.sh
```

Then load `extension/manifest.json` from `about:debugging` in Firefox. Firefox may
require file URL access to be enabled for the temporary add-on before local files can
open automatically.

The extension source does not require a compile step for normal development. The npm
tooling runs formatting, tests, WebExtension linting, and packaging checks against the
source tree directly.

xterm.js runtime assets are vendored into `extension/vendor/xterm/` so the unpacked
extension can run without a build step. After changing xterm-related npm dependencies,
refresh those assets with:

```sh
npm run vendor:xterm
```

## Checks

Run the formatter and checks before sharing changes:

```sh
npm run format
npm run check
```

The repository uses:

- Prettier for Markdown, JSON, HTML, CSS, and JavaScript.
- markdownlint for Markdown structure.
- Ruff for Python formatting and linting.
- web-ext for Firefox extension validation.

Markdown and Python should stay within an 88-character line length.

Focused commands:

```sh
npm run test:js
npm run test:py
npm run lint:extension
npm run package:extension
```

## Licensing And Attribution

Project source is licensed under Apache-2.0. The `NOTICE` file carries project
attribution that downstream redistributors should preserve under the license terms.
Contributions are accepted under Apache-2.0 under section 5 of the license. Sign-offs
are not required unless project policy changes.

Before copying code, assets, generated tables, or substantial snippets from another
project, record the source, license, and attribution requirements. Do not vendor prior
project source unless its license is compatible with Apache-2.0 and the required notices
are captured in `NOTICE` or another appropriate third-party notice file.

## Package Metadata

The npm package is marked private because the distributable artifact is a browser
extension, not an npm library. Revisit that setting only if the project starts
publishing reusable packages to npm.

## Git Hooks

The repository includes local hooks under `.githooks`.

```sh
scripts/install_git_hooks.sh
```

The pre-commit hook runs formatting and checks, then fails if formatting changed files.
The pre-push hook runs checks.

## Test Scope

Automated tests should cover:

- Main-frame activation and subresource exclusion.
- HTTP status and snapshot timeout handling.
- URL allow and deny rules.
- Built-in, denied, unchecked, and custom filetype behavior.
- Options import, export, validation, and defaults.
- xterm.js asset vendoring.
- Viewer protocol helpers.
- Native messaging framing and fragmentation.
- Neovim executable discovery.
- Local path decoding.
- Temp file creation and cleanup.
- Git-root discovery.
- Neovim launch argument construction.
- PTY input and output forwarding.
- Optional startup command behavior.
- Viewer resize delivery to Neovim.
- Dirty-state tracking without interactive RPC queries.
- Process-group termination on close.

Manual Firefox smoke tests should cover:

- Local Markdown opens in Neovim.
- Local Python opens writable.
- Local JSON stays unchecked by default.
- HTTP raw Markdown opens read-only.
- Rendered HTML pages stay in Firefox.
- Raw source URLs open only when the URL and filetype rules allow them.
- Page subresources do not trigger the extension.
- Options pages use the Firefox default zoom; viewer pages use the configured viewer
  zoom.
- Tab close terminates the native host and Neovim process.
- Modified local opened files warn before tab close.
- Read-only snapshots close without save warnings.
- Normal-mode sequences, counts, text objects, registers, macros, and user mappings are
  interpreted by Neovim.
- Plugin-driven redraws, including smooth scrolling, remain visible.
