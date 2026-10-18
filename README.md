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

`http://localhost` is the default for local dev. The session cookie is `__Host-sid; Secure`: Chromium and
Firefox accept it on `http://localhost`, WebKit/Safari does not. For Safari/WebKit dev, serve over HTTPS by setting
`TLS_CERT_FILE` and `TLS_KEY_FILE` (both optional), for example with a locally trusted cert from
[mkcert](https://github.com/FiloSottile/mkcert): `mkcert localhost` then point the two vars at the generated files and
use `APP_ORIGIN=https://localhost:3000`. The e2e suite always runs over HTTPS with a throwaway self-signed cert.

`AUTH_RATE_LIMIT` (per-IP requests per minute on `/api/auth/*`) defaults to 30 (ADR 0005); only the e2e config raises it.
