# Security

## Reporting a vulnerability

Please report vulnerabilities privately before opening a public issue. Use the
repository's **Security → Report a vulnerability** option when it is available,
or contact Cygma Audio through the
[RushLink contact page](https://rush-link.github.io/about.html#contact). Mention
that the message concerns RushLink security and provide a safe way to reply.

Include the affected RushLink version or commit, operating system, device model
and firmware, the impact, and the smallest reproducible example. Use fictional
rig names and remove tokens, local addresses, serial numbers, account details
and private device captures. A description is enough for an initial report;
avoid sending credentials or a complete device backup.

For ordinary bugs and feature requests, use the
[issue tracker](https://github.com/Rush-Link/RushLink-App/issues).

## Supported versions

RushLink is early-alpha software. Security fixes target the current `main`
branch and the latest release. Older releases may require an upgrade; separate
maintenance branches and response-time guarantees are not currently offered.

## Device and local-data boundaries

RushLink connects to a HeadRush device over its local Remote interface. Treat
that interface as accessible to other users of the same network: use a trusted
network and do not expose the device's HTTP or WebSocket ports to the internet.
Application changes cannot add authentication to the device's own server.

Device responses, imported backup files, catalogue metadata and links are
untrusted input. Preserve native URL and route validation, Tauri capabilities,
the content security policy, and file-picker boundaries when changing those
features. Test protocol behavior with synthetic fixtures rather than recordings
of a user's device.

Rig names, setlists, presets and backups can reveal personal information.
Review and redact diagnostics before sharing them. See [PRIVACY.md](PRIVACY.md)
for the application's data handling.
