# Security Policy

## Reporting

Please report security issues privately through GitHub's security advisory flow once the
repository is public. Until that is available, do not file public issues containing
exploit details.

## Scope

Security-sensitive areas include:

- Native messaging host installation and manifest generation.
- Local file path decoding and Neovim process launch.
- User-configured Neovim startup commands.
- Temporary files for HTTP(S) snapshots.
- Extension page content security policy.
- Any code path that handles file contents, URLs, or native-host diagnostics.

The extension should not send file contents, paths, diagnostics, or crash data to
network services without explicit user opt-in.

Imported settings are local configuration, not untrusted data. A startup command can run
Neovim commands when enabled, so users should not import settings from sources they do
not trust.
