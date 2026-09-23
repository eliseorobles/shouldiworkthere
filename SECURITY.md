# Security policy

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/eliseorobles/shouldiworkthere/security/advisories/new).
If that is unavailable, contact **privacy@shouldiworkthere.com** with the subject “Security report”.
This mailbox is operated by the project's legal operator. Email is not an anonymous channel.

Include the affected version/commit, impact, and minimal reproduction using synthetic data.
Do not send real mailbox credentials, private signing keys, unpublished contributions, or identity data.
Please discuss a safe way to share sensitive details before transmitting them. Do not open a public
issue containing an unpatched exploit or someone else's personal information.

The maintainer coordinates fixes and public advisories with reporters. Responses are best-effort;
there is no guaranteed timeline or paid bounty program. Credit is optional and agreed with the reporter.

## Supported versions

Security fixes target the latest `0.x` release and `main`. Older preview releases are not maintained
as separate branches. Operators should follow releases and security advisories and update promptly.

## Research scope

Use a local deployment with the fictional seed data and test keys. The repository's license does not
authorize testing systems operated by others. Do not flood verification mail, attempt to identify
contributors, access other people's records, or run destructive tests against the live service.

See [the threat model](docs/threat-model.md) and [hardening roadmap](docs/hardening-roadmap.md).
Publishing code and signing releases support inspection; they do not constitute an independent
security audit or establish which backend code a hosted operator executes.
