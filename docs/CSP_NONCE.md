# CSP nonce pipeline (Phase E4 — long-term)

## Current state

Production CSP in `frontend/next.config.ts`:

- Drops `'unsafe-eval'`
- Still allows `'unsafe-inline'` for `script-src` because Next.js injects bootstrap inline scripts
- Headers are **static** (no per-request nonce)

This is intentional and documented in `SECURITY.md`. Full nonce removal of `unsafe-inline` is a larger Next.js change.

## Target design

1. **Proxy / middleware** generates a cryptographically random nonce per request.
2. Set response header:
   ```
   Content-Security-Policy: script-src 'self' 'nonce-{n}' 'strict-dynamic'; …
   ```
   (exact directives to be tuned with PWA + Workbox).
3. Pass nonce into the HTML document (`<Script nonce={…}>` / root layout).
4. Remove static CSP from `next.config.ts` headers (or make it a report-only baseline) so the **dynamic** header wins.

## Next.js notes

- Next App Router has evolving support for nonces (`experimental` / framework docs for your exact version).
- PWA (`next-pwa` / Workbox) and third-party scripts must be audited so they do not break under `strict-dynamic`.
- Prefer **report-only** first: `Content-Security-Policy-Report-Only` while measuring violations.

## Acceptance criteria (when implementing)

- [ ] No `'unsafe-inline'` in production `script-src` (or only as temporary dual-policy during rollout)
- [ ] Login, dashboard, platform console, and PWA install still work
- [ ] Supabase auth + realtime `connect-src` unchanged
- [ ] Document env/flags in `docs/ENV.md`

## Out of scope for Phase E migration work

E4 is **docs + planning only** in this phase. Do not flip production CSP to nonce without a dedicated PR and browser QA.
