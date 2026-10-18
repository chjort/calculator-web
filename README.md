# calculator-web

A fast, accurate calculator in the browser. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

Requires Node 20+, pnpm 10 and Postgres 16+.

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test   # API tests need DATABASE_URL_TEST (default postgres://calc@localhost:5432/calc_test)
pnpm e2e                                    # builds the SPA, starts the server over HTTPS on :41731 (DATABASE_URL_E2E)
```

Run the app (the server serves the built SPA and the API on one origin):

```sh
pnpm build
DATABASE_URL=postgres://calc@localhost:5432/calc APP_ORIGIN=http://localhost:3000 \
  WEB_DIST=$PWD/apps/web/dist pnpm --filter @calc/server start
```

The session cookie is `__Host-sid; Secure`. Chromium and Firefox accept it on `http://localhost`;
Safari/WebKit does not, so use HTTPS there (`TLS_CERT_FILE` / `TLS_KEY_FILE`, as the e2e config does).
