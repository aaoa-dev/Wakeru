# Wakeru architecture

## Current deployment model

Wakeru is a static application with a generated, read-only data catalog:

- Importers in `scripts/import/` download and normalize municipal source data.
- `data/municipalities.json` is the small catalog used by onboarding.
- `data/municipalities/<prefecture>/<municipality>/municipality.json` is loaded only after a municipality is selected. It contains that municipality's final town/chome level.
- Large sibling `dictionary.json` sorting dictionaries are loaded only after a search.
- The browser stores only the selected location (and theme choice) in local storage. There is no user database.
- `sw.js` makes the app installable and usable offline. Same-origin requests are network-first, so a deploy is live on the next load and the cache is only an offline fallback; data files are cached as they are opened, never the whole catalog. Bump `CACHE` in `sw.js` only if the precached shell list changes.

This is deliberate. GitHub Pages cannot run a database or server-side code, but it can serve these generated files efficiently. Cloudflare Pages can serve the same files at the edge, so moving hosts does not require a data migration.

## Why D1 is not the catalog yet

The municipal catalog is public, immutable for a deployment, and normally fetched once per user. Putting every read behind D1 would add an API, runtime failure modes, and query latency without reducing the shipped data: the app already downloads only the selected municipality, and HTTP compression makes even the largest dictionary much smaller on the wire.

Keep the generated JSON as the source of truth until Wakeru needs at least one server-side capability:

- user accounts or cross-device saved locations;
- community corrections, moderation, or an admin interface;
- server-side full-text search across all municipalities;
- private data or rate-limited upstream integrations;
- analytics that cannot be handled by privacy-preserving edge analytics.

At that point, add a narrow `/api/` surface with Cloudflare Pages Functions (or a Worker) and bind D1 only to those routes. The static catalog can remain the fast read path while mutable records live in D1.

## Deployment targets

### GitHub Pages (current)

The Pages workflow validates the schedule/data contract, runs `npm run build`, and publishes `dist/`. Import scripts, caches, and source-only metadata never enter the public artifact.

### Cloudflare Pages (later)

Use `npm run build` as the build command and `dist` as the output directory. The build copies `_headers` into the output so Cloudflare can add security headers and revalidation for catalog data.

Do not add a D1 binding until an `/api/` route needs it. Static files should continue to bypass Functions.
