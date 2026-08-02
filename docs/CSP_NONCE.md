# CSP nonce pipeline (Phase E4 — long-term)

## Current state (post low-hardening)

Enforcing CSP is built by `frontend/src/lib/csp.ts` and applied from:

- `frontend/next.config.ts` (static headers)
- `frontend/src/proxy.ts` (request-time, same builder)

| Directive | Production | Notes |
|-----------|------------|--------|
| `script-src` | `'self' 'unsafe-inline'` | Still required for Next.js bootstrap until nonce is wired into the HTML document |
| `script-src-attr` | `'none'` | **Hardened** — blocks `onclick=` / inline event-handler attributes |
| `object-src` / `frame-ancestors` / `base-uri` | locked down | Already present |
| `unsafe-eval` | **dropped** in production | Dev keeps it for tooling |

No `dangerouslySetInnerHTML` in app source. Residual XSS impact from `unsafe-inline` scripts remains until E4 completes.

`buildContentSecurityPolicy({ nonce, strictScripts })` supports experimental nonce / strict modes for a future dual-header rollout — **do not** set the enforcing header to `strictScripts: true` until root layout passes the nonce into Next scripts.

## Target design

1. **Proxy** generates a cryptographically random nonce per request.
2. Set response header:
   ```
   Content-Security-Policy: script-src 'self' 'nonce-{n}' 'strict-dynamic'; …
   ```
   (exact directives to be tuned with PWA + Workbox).
3. Pass nonce into the HTML document (`headers().get('x-nonce')` → `<Script nonce={…}>` / root layout).
4. Remove static CSP from `next.config.ts` headers (or make it a report-only baseline) so the **dynamic** header wins.
5. Drop `'unsafe-inline'` from enforcing `script-src`.

## Next.js notes

- Next App Router has evolving support for nonces (`experimental` / framework docs for your exact version).
- PWA (`next-pwa` / Workbox) and third-party scripts must be audited so they do not break under `strict-dynamic`.
- Prefer **report-only** first: `Content-Security-Policy-Report-Only` while measuring violations.

## Acceptance criteria (when implementing)

- [ ] No `'unsafe-inline'` in production `script-src` (or only as temporary dual-policy during rollout)
- [ ] Login, dashboard, platform console, and PWA install still work
- [ ] Supabase auth + realtime `connect-src` unchanged
- [ ] Document env/flags in `docs/ENV.md`

## Out of scope without a dedicated PR

Do not flip production CSP to nonce-only / `strictScripts` without browser QA. Incremental hardening (`script-src-attr 'none'`) is already in the enforcing policy.
