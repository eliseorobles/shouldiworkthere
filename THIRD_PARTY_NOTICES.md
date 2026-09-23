# Third-party notices and license scope

Original application code, repository documentation, and original fictional test fixtures are
licensed under [MIT](LICENSE). Third-party material retains its own license and copyright notices.
The repository's code license does not license workplace submissions, private operational records,
third-party employer trademarks, or the operator's branding rights; see [TRADEMARKS.md](TRADEMARKS.md).

## Runtime software and fonts

Exact locked versions, declared licenses, and complete notice-file paths are recorded in
[`licenses/index.json`](licenses/index.json). The `licenses/` directory contains the upstream text
and is included in the downloadable source bundle even when minification removes code comments.

| Component | License |
|---|---|
| React, React DOM, Scheduler | MIT |
| Zod | MIT |
| Cloudflare blindrsa-ts | Apache-2.0 |
| Stanford JavaScript Crypto Library (SJCL), used by blindrsa-ts | BSD-2-Clause option of its BSD/GPL dual license |
| Instrument Sans | SIL Open Font License 1.1 |
| JetBrains Mono | SIL Open Font License 1.1 |

We use SJCL under its BSD option. Its full upstream notice is preserved. Font packages contain
upstream font copyright and reserved-name information; preserve those notices when redistributing.

Build and development tools (including Wrangler, TypeScript, esbuild, and Playwright) are installed
from the locked dependencies, not vendored into this repository. Their upstream licenses continue
to apply. Hosted providers and model access have separate terms; this repository does not distribute
Jev model weights or grant a provider subscription.

## Keeping notices current

`node tools/licenses.mjs --write` collects license and notice texts for installed runtime dependencies,
including transitive dependencies. `npm run check:licenses` verifies them against the installed lockfile
resolution. A missing notice fails the check and needs a maintainer review, not an invented license.

Open Graph images under `web/og/` are project-generated graphics made by `tools/og.mjs` using these
fonts and project text. Separate launch-video projects, downloaded media, machine-installed agent
skills, local exports, and dependency caches are outside this source release.
