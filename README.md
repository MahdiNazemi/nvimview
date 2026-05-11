# NvimView

NvimView is a Firefox WebExtension that opens eligible top-level local and HTTP(S)
source-like files in a full-tab local Neovim session.

NvimView is an independent project and is not affiliated with, endorsed by, or sponsored
by the Neovim project.

## Install For Local Testing

Install JavaScript dependencies and the native-host Python environment:

```sh
npm install
scripts/install_native_host.sh
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and
select [extension/manifest.json](extension/manifest.json).

NvimView targets Firefox 142 or newer.

For local files, enable file URL access for the temporary add-on in Firefox's extension
details page. On macOS, the first launch may ask for permission to access the checkout
directory. Allow it so the native host can execute the local Python environment and open
files from that location.

The native-host manifest points at this checkout. If you move the repository, rerun
`scripts/install_native_host.sh`.

## Usage

After installation, eligible top-level source-like files open in the full-tab Neovim
viewer automatically. Local `file://` pages open writable by default. HTTP(S) files open
as read-only snapshots. File types such as JSON, PDF, SVG/images, and XML stay unchecked
unless those defaults are changed in the extension options.

Click the extension toolbar button, or open the Firefox add-on preferences, to edit
filetype rules, URL allow/deny rules, and Neovim viewer settings.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and packaging workflow. The
architecture contracts live in [ARCHITECTURE.md](ARCHITECTURE.md). Security-sensitive
behavior is covered in [SECURITY.md](SECURITY.md). Deferred ideas live in
[ROADMAP.md](ROADMAP.md), and prior-art references live in
[docs/prior-art.md](docs/prior-art.md).
