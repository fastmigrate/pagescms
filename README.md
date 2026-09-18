# Pages CMS

> This repository is the public FastMigrate downstream fork. See
> [DOWNSTREAM.md](DOWNSTREAM.md) for its update and release policy and
> [PATCHES.md](PATCHES.md) for active differences from upstream.

[Pages CMS](https://pagescms.org) is an open source CMS for GitHub repositories. It is especially well suited for static sites and content-driven apps built with tools like Jekyll, Hugo, Next.js, Astro, VuePress, and similar stacks.

fastmigrate.net operates this downstream fork at
[cms.fastmigrate.net](https://cms.fastmigrate.net). The upstream project also
offers its separate hosted service at `app.pagescms.org`; do not use that
service for fastmigrate.net customer repositories.

[![Screenshot of the Pages CMS editor](https://pagescms.org/media/screenshot.png)](https://demo.pagescms.org)

*[Watch the demo ▶](https://demo.pagescms.org)*

## Documentation

Full documentation lives at [pagescms.org/docs](https://pagescms.org/docs).

Useful starting points:

- [Install locally](https://pagescms.org/docs/guides/installing/)
- [Create the GitHub App](https://pagescms.org/docs/guides/installing/github-app/)
- [Environment variables](https://pagescms.org/docs/development/environment-variables/)
- [Upgrading to 2.x](https://pagescms.org/docs/guides/upgrading-to-2/)

## fastmigrate.net production instance

Use [cms.fastmigrate.net](https://cms.fastmigrate.net) for fastmigrate.net customer
repositories. Production runs an immutable reviewed commit from this fork.

The upstream `app.pagescms.org` service is not part of fastmigrate.net operations,
authentication, deployment, or support.

## Fast local fixture

For component and interaction work that does not need real GitHub behavior:

```bash
npm install
npm run dev:fixtures
```

Open
`http://localhost:3000/dev/fixtures/entry-duplicate`. Fixtures render real CMS
components with deterministic in-memory responses. They require the explicit
development flag, return 404 in production, and never authenticate, access
PostgreSQL, call GitHub, or create commits.

Use fixtures to iterate on UI and client behavior before opening a PR. They do
not replace route tests or the authenticated sandbox check for GitHub write
semantics.

## Authenticated local sandbox

For real authentication, GitHub API, branch, conflict, and commit behavior:

1. Copy `.env.local.example` to `.env.local`.
2. Create a dedicated local GitHub App and install it only on a private sandbox
   repository:

```bash
npm run setup:github-app -- --base-url http://localhost:3000 --env .env.local
```

The helper disables webhook delivery for loopback URLs because GitHub cannot
reach them. That is sufficient for authentication and normal CMS reads and
writes. To test webhook-driven cache invalidation as well, expose the local CMS
through a public tunnel and pass that HTTPS URL as `--base-url` instead.

3. Start PostgreSQL, apply migrations, and run the local app:

```bash
npm run dev:local
```

Stop the retained development database with `npm run dev:local:down`. Customer
repositories must not be used for local feature development.
The launcher refuses inherited GitHub, auth, email, URL, crypto, database, or
fixture values; keep sandbox configuration only in `.env.local` so a parent
shell cannot silently replace it with customer or production configuration.

The sandbox path is intended for checks that fixtures cannot represent:

- GitHub App installation and user authentication,
- repository and branch discovery,
- create/update conflicts and commit metadata,
- webhook-driven cache behavior when the App uses a public tunnel URL.

## Local development

### What you need

- PostgreSQL
- a GitHub App
- a local `.env.local`
- the Pages CMS repo checked out locally

### Quick start

1. Clone the repository:

```bash
git clone https://github.com/pagescms/pagescms.git
cd pagescms
```

2. Start PostgreSQL locally:

```bash
docker run --name pagescms-db -e POSTGRES_USER=pagescms -e POSTGRES_PASSWORD=pagescms -e POSTGRES_DB=pagescms -p 5432:5432 -d postgres:16
```

3. Install dependencies:

```bash
npm install
```

4. Create `.env.local` with at least:

```bash
DATABASE_URL=postgresql://pagescms:pagescms@localhost:5432/pagescms
BETTER_AUTH_SECRET=your-random-secret
CRYPTO_KEY=your-random-secret
```

Optional but useful:

```bash
BASE_URL=https://cms.example.com
ADMIN_EMAILS=admin@example.com
```

Notes:

- In production, `BASE_URL` should be the single canonical URL for the app.
- Do not mix a custom domain and a `*.netlify.app` URL for the same install.
- `ADMIN_EMAILS` is a comma-separated allowlist for access to the admin panel.

Generate secrets with:

```bash
openssl rand -base64 32
```

5. Create your GitHub App with the helper:

```bash
npm run setup:github-app -- --base-url http://localhost:3000
```

Useful options:

- `--owner-type personal|org`
- `--org <slug>`
- `--app-name "Pages CMS (local)"`
- `--env .env.local`
- `--no-open`

6. Run database migrations:

```bash
npm run db:migrate
```

If cache state is known stale or corrupted, clear it with:

```bash
npm run db:clear-cache
```

7. Start the app:

```bash
npm run dev
```

If you need GitHub webhooks to reach your local app, use a public tunnel URL as the helper `--base-url`.

For more detail, see:

- [Install locally](https://pagescms.org/docs/guides/installing/)
- [Create the GitHub App](https://pagescms.org/docs/guides/installing/github-app/)
- [Environment variables](https://pagescms.org/docs/development/environment-variables/)
- [Caching](https://pagescms.org/docs/development/caching/)

## Support the project

- [Contribute code](https://github.com/pagescms/pagescms/pulls)
- [Report issues](https://github.com/pagescms/pagescms/issues)
- [Sponsor me](https://github.com/sponsors/hunvreus)
- [Star the project on GitHub](https://github.com/pagescms/pagescms)
- [Join the Discord chat](https://pagescms.org/chat)

## License

Everything in this repo is released under the [MIT License](LICENSE).
