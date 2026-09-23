# Self-hosting

The application consists of a publisher, a mailbox verifier, and an inference worker. The architecture,
secret ownership, and deployment sequence are documented in [the README](../README.md) and
[operations](operations.md). First run the local development setup and tests in [CONTRIBUTING](../CONTRIBUTING.md).

The checked-in Wrangler files describe the official deployment. Their account/database IDs are public
identifiers, not credentials. A fork must configure its own resources before any remote command.

## Configure your installation

1. Create your own Cloudflare account and zone, with a main hostname and a separate verifier hostname.
   The existing code expects Cloudflare Workers, D1, R2, Queues, rate-limit bindings, and email sending.
2. In all three root `*.wrangler.jsonc`/`wrangler.jsonc` files, replace `account_id` with your account ID.
   Create three D1 databases and update their `database_id` values. Inference and main share the **public**
   database; intake belongs only to main, and verifier storage belongs only to the verifier.
3. Create the analysis queue, its dead-letter queue, and the archive bucket. Match the names in the
   configs. The scripts currently use the names `shouldiworkthere-public`, `shouldiworkthere-intake`, and
   `shouldiworkthere-verifier`; keeping those names in your own account avoids script edits. If you rename
   resources, update every reference in `tools/`, `package.json`, and the service/queue bindings together.
4. Replace the main route and `PUBLIC_ORIGIN`. In the verifier config, set its custom-domain route,
   `ALLOWED_ORIGIN`, and `EMAIL_FROM`. Set the main worker's `VERIFIER_ORIGIN` to that verifier origin.
   The build derives its verifier pin from the verifier's custom-domain route and rejects a mismatch.
   `tools/redirect-worker/` is the official deployment's legacy-domain redirect and is optional for a fork.
5. Configure email sending and verify delivery from your own sender. Keep email disabled until it works.
   In local development email is simulated, and the sample credential flow does not need a mailbox.
6. Configure Jev access: the inference worker supports Workers AI through AI Gateway and a TypeSafe HTTP
   fallback. Set gateway/provider variables and the appropriate provider credentials. Turn off gateway
   logging/caching as described in operations. Without inference, deterministic controls remain usable,
   while model-dependent screening and employer-listing checks report unavailable.

See Cloudflare's [configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/)
and [local development guide](https://developers.cloudflare.com/workers/local-development/).

## Identity, keys, and first deployment

- Give your service its own name and operator details in `shared/brand.ts`, including canonical origin,
  contacts, jurisdiction, and legal facts. The official operator's mailbox checks and legal-review flag
  do not apply to your installation; set unverified facts to false/null and update the legal review copies
  and corresponding tests to reflect your actual configuration.
- Generate your own secrets. The README lists each worker's secret names. Provision them with
  `bunx wrangler secret put NAME --config CONFIG`; never commit their values. Only the documented shared
  tokens should cross worker boundaries.
- Migrate your own databases following the runbook. Review migration headers and row-changing flags.
  `db/seed.sql` is destructive fictional development data and is never applied remotely.
- Provision your own issuer registry using `tools/provision-issuer.mjs --remote --no-samples`, with your
  verifier master key supplied through the environment. It replaces `db/issuer-public-keys.*` for your
  installation. The official public keys in this repository cannot sign credentials for your service.
- Initialize your own release-signing key with `tools/transparency.mjs --init-key` after a production
  build. Keep private keys offline/backed up separately. Historical `docs/releases/` records identify
  the official operator's earlier releases; they are not endorsements of a fork's releases.
- Follow the ordered deployment and verification steps in operations, passing your own site/verifier
  origins to `tools/verify-deployment.mjs`. The verifier and inference must exist before main binds them.

## Costs and operational responsibility

Expect costs for Workers execution, D1 reads/writes/storage, Queues, R2 storage/operations, email,
domain registration, and inference. There is no measured universal monthly estimate. Consult the
providers' current pricing and set account alerts and application call budgets for your traffic.
Local tests use synthetic data and do not require paid provider access.

Operating a service means handling mailbox delivery, key rotation, backups, legal/privacy contacts,
listing corrections, and software updates. Review the threat model and runbook before accepting real
contributions. Independent operator separation and a completed external audit are still roadmap items.
