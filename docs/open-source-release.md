# Public source releases

Maintainer: [@eliseorobles](https://github.com/eliseorobles).

## Before a source release

1. Review changes, third-party rights, `bun.lock`, notices, and the exact `public-source.json` paths.
   Keep production records, private keys, environment files, screenshots containing private data,
   local exports, and separately licensed media out of the repository and release attachments.
2. Run a frozen install, `npm run check:publication`, `npm run check:licenses`, a local build,
   typechecking, unit tests, and the full local-stack/browser suites in a fresh checkout.
3. Run `gitleaks git --redact --no-banner` over the complete history. For new staged changes use
   `gitleaks git --pre-commit --staged --redact --no-banner`. A leak requires credential revocation or
   rotation as well as repository cleanup. Rewriting history cannot retract copies already downloaded.
4. Update the package version and changelog. Check that required GitHub checks pass on the release commit.
5. Create an annotated `vX.Y.Z` tag at that commit and publish GitHub release notes that identify the
   exact commit, changes, verification, and known limitations. GitHub supplies source archives for the tag.

## GitHub controls

Require CI, maintainer review where another maintainer is available, and resolved conversations on
`main`. Disable force pushes and branch deletion. Enable secret scanning, push protection, private
vulnerability reporting, dependency alerts/updates, and CodeQL. Keep Actions permissions minimal and
pin third-party actions to complete commit SHAs. Dependabot proposes Action and Bun dependency updates.

PR workflows use no production credentials or private release keys. Never execute a contributor's
checkout in a privileged `pull_request_target` job. Review workflow changes as production-sensitive code.

## Hosted releases

A GitHub source release and a hosted deployment are separately recorded events. Follow
[operations](operations.md) to build, sign, deploy, and verify the hosted version. Preserve the
append-only signed manifests in `docs/releases/` and identify their paths and source commit in the
corresponding deployment release notes. A source tag alone does not claim that production runs it.

Keep release signing under maintainer control. Publishing this repository does not provision any
production secrets in Actions or enable automatic deployment. Preserve the distinction between
verifying public client/source hashes and proving which code a remote backend executes.
