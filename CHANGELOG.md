# Changelog

## 0.1.0 — Initial public source release

- Publish the React client, three Cloudflare Workers, blind-RSA credential protocol, executable
  moderation policy, database migrations, fictional development fixtures, tests, and documentation.
- Add an exact public-source manifest, private-file checks, secret scanning, and runtime license notices.
- Document contribution, security reporting, self-hosting, project branding, and maintainer releases.
- Add credential-free CI for typechecking, unit tests, integration checks, and browser tests.
- Fix local-build instructions, remove the local launcher's hardcoded account override, and derive
  the production verifier pin from the verifier's deployment configuration.
- Use rejection sampling for unbiased mailbox-code, shuffle, and analysis-delay integer draws.
- Omit the remote-only Workers AI binding from generated local development configurations.
- Move clarification-panel focus after React commits its DOM, fixing a keyboard-accessibility race.

This is preview software. Hosted Jev calls require provider access; keyless local development uses
degraded/manual controls. The protocol and moderation system have not received an independent audit.
See the README's honest status and the hardening roadmap for remaining limitations.
