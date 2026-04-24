# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Mis Finanzas** — A personal finance management app for a Colombian user. Single self-contained `index.html` file with no build step, no dependencies, and no framework. Everything (HTML, CSS, JS) lives in one file. Serverless API functions live in `api/`. A service worker (`sw.js`) enables offline support.

## Pending Work

All 5 phases of the improvement plan are complete. No pending mandatory work.

**Fase 5** (optional modular refactor — splits single HTML into multiple JS/CSS files, ~6-10h) is deferred indefinitely. Requires 48h in prod without regressions as a prerequisite.

## Deployment

- **GitHub:** `https://github.com/simonvelezt1/APP-finanzas-personales`
- **Vercel (live):** `https://app-finanzas-personales-mu.vercel.app`
- **GitHub Pages:** `https://simonvelezt1.github.io/APP-finanzas-personales/`

Any edit to `index.html` auto-commits and pushes to GitHub via a PostToolUse hook (`.claude/settings.json`). Vercel and GitHub Pages both auto-deploy on push. `vercel.json` sets `Cache-Control: no-cache` on the HTML so browsers always fetch the latest version.

**Sync rule:** GitHub, Vercel and Supabase must always be in sync. `index.html` edits auto-push via the PostToolUse hook. Changes to other **tracked** files (e.g. `vercel.json`, `CLAUDE.md`, `api/*.js`, `sw.js`) must be committed and pushed manually: `git add <file> && git commit && git push`.

## What lives where

| File | GitHub | PC only | Why |
|---|---|---|---|
| `index.html` | ✅ auto-push | | The app |
| `sw.js` | ✅ manual push | | Service worker for offline support |
| `api/polymarket.js` | ✅ manual push | | Vercel proxy for Polymarket |
| `api/wallet-balance.js` | ✅ manual push | | Vercel proxy for Moralis/BTC/SOL |
| `api/trm.js` | ✅ manual push | | Vercel proxy for TRM (server-side, avoids CORS) |
| `vercel.json` | ✅ manual push | | Deployment config + security headers |
| `CLAUDE.md` | ✅ manual push | | Architecture docs |
| `.gitignore` | ✅ manual push | | Protects local files |
| `logo.png` | ✅ manual push | | App icon (whitelisted via `!logo.png` in .gitignore) |
| `.claude/` (toda la carpeta) | 🚫 never | ✅ | Configuración de Claude — gitignored completa |
| `*.png / *.jpg` (except logo.png) | 🚫 never | ✅ | Personal images — gitignored |

**Rule:** Never use `git add .` or `git add -A` — always add files by name to avoid accidentally pushing personal files.

## Architecture

The app is `index.html` + three Vercel API proxy functions in `api/` + a service worker `sw.js`. There is no build process.

### Vercel API Functions

All functions run in **Frankfurt (fra1)** to avoid geo-blocks and keep API keys server-side.

#### `api/polymarket.js`
- Proxies `GET /api/polymarket?user={walletAddress}` → `data-api.polymarket.com/positions`
- No API key required — Polymarket Data API is public
- Returns user's open prediction market positions
- CORS: restricted to the production Vercel/GitHub Pages origins

#### `api/wallet-balance.js`
- Proxies `GET /api/wallet-balance?address={evm}&chains={...}&btcAddress={...}&solAddress={...}` → Moralis + mempool.space + Binance
- Requires `MORALIS_KEY` environment variable set in Vercel dashboard (never in code)
- BTC (mempool.space) works without `MORALIS_KEY` — only EVM/SOL require it
- Supports EVM chains (eth, polygon, bsc, base, avalanche) via Moralis
- Supports Bitcoin via mempool.space (balance) + Binance (price) — no key needed
- Supports Solana + SPL tokens via Moralis Solana gateway (same key)
- All chains queried in parallel via `Promise.allSettled`
- Returns `{ tokens, errors: [{source, message}] }` — partial failures are reported, not dropped
- **EVM native price fallback:** `CHAIN_BINANCE_PAIR` maps each chain to its Binance XXUSDT pair. When Moralis returns `null` for `usd_price` on a native token (ETH, BNB, POL, AVAX), `getNativePrice(chain)` fetches from Binance with a 3s timeout. BTC and SOL already used Binance directly.
- **Stablecoin price fallback:** `STABLECOINS` set (USDC, USDT, DAI, BUSD, TUSD, FRAX, LUSD, USDP, USDC.E, USDT.E, USDCE) — when Moralis returns `null` for `usd_price`/`usd_value`, these tokens get `usd_price: 1.0` injected. Applied to both ERC-20 and SPL tokens.
- **Token filter:** non-native tokens kept if `usd_value > 0.01` **or** `balance >= 0.001` (catches stablecoins with missing price data)
- CORS: restricted to the production Vercel/GitHub Pages origins

#### `api/trm.js`
- Proxies TRM (USD→COP) from 4 sources server-side (avoids client CORS issues)
- Returns `{ trm, date, source }` on success; `{ error, details }` on failure
- Sources tried in order: Banco de la República → open.er-api.com → exchangerate-api.com → fawazahmed0/currency-api (jsDelivr CDN)
- Cache: `s-maxage=1800, stale-while-revalidate=3600` (30 min fresh, 1 hr stale)
- No API key required
- **Note:** Frankfurter was considered but rejected — ECB does not track COP

### Security Headers

**`vercel.json`** (applies to Vercel deployment):
- `Content-Security-Policy` — restricts scripts, images, connect sources to known-good origins
- `X-Frame-Options: DENY` — blocks clickjacking
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

**CSP `<meta>` tag** (applies to GitHub Pages where vercel.json has no effect):
- Allows `script-src`: self + cdn.jsdelivr.net + cdnjs.cloudflare.com + `'unsafe-inline'` (needed for inline `<script>` block)
- `connect-src`: self + Supabase (http+wss) + datos.gov.co + open.er-api.com + api.exchangerate-api.com
- `object-src 'none'`; `base-uri 'self'`

### Service Worker (`sw.js`)

Registered in `DOMContentLoaded`. Provides offline support:
- **Install:** caches `['/', '/index.html', '/logo.png']`
- **Activate:** deletes old cache versions; claims clients immediately
- **Fetch:** navigation requests → network-first with cache fallback; other GET requests → cache-first
- Cache name: `mf-v1` — bump to `mf-v2` when breaking changes require a fresh cache

### State

A single global object `S` holds all runtime state. It is persisted to `localStorage` under the key `mf_v1`. On load, it also tries legacy keys (`fin_v5`, `fin_v4`, `fin_v3`) for backwards compatibility.

```js
S = {
  trm,            // USD→COP exchange rate (default 4350)
  trmMan,         // true if TRM was set manually
  trmDate,        // display string for TRM source/date
  trmOpen,        // UI-only toggle state for TRM edit row (not persisted)
  txs[],          // transactions: { id, tipo, wal, cat, monto, desc, fecha, ctaId }
  invs[],         // investments: { id, nom, wal, cost, val }
  ctas[],         // accounts: { id, nom, banco, tipo, wal, saldo, cupo? }
  cats[],         // categories: { id, n, i }
  bud: { general, COP: {catId: amount}, USD: {catId: amount} },
  cat, wal, tipo, bWal, iWal, cWal,   // UI selections
  vm, vy, bm, by,                      // month/year for history and budget views
  editCta,        // id of account currently being inline-edited (null otherwise)
  privGlobal,     // boolean — global privacy mode (hides all monetary values app-wide)
  priv: {},       // per-widget privacy: { tot, cash, gm, bal, sav, topcat } → boolean
  polyWallet,     // string — Polymarket proxy wallet address (0x...)
  wallets[],      // crypto wallets: { id, type, label, address, chains[] }
  _uiFilters,     // NOT persisted — { fw, fc, ft, txSearch } filter state for Movimientos
}
```

**`_uiFilters`** is not in `PERSIST_KEYS` and is never written to localStorage or Supabase. `renderHist()` reads from it; the HTML inputs write to it on change. `chM()` clears `_uiFilters.txSearch` on month navigation.

**Entity IDs** use `crypto.randomUUID()` for all new entities (transactions, accounts, investments, wallets, categories). Existing data with numeric `Date.now()` IDs is migrated to strings automatically in `load()` and `syncDown()`. All `onclick` attributes that pass IDs quote them as strings: `onclick="delTx('${t.id}')"`.

**`PERSIST_KEYS` and `buildPersistPayload()`:** a single source of truth for what gets written to localStorage and Supabase. Adding a new persisted field requires only adding it to `PERSIST_KEYS`. Never manually construct the payload object in `syncUp`, `syncDown`, `persist`, or `resetApp` — always call `buildPersistPayload()`.

```js
const PERSIST_KEYS = ['txs','invs','ctas','cats','bud','trm','trmMan','trmDate','privGlobal','priv','polyWallet','wallets'];
```

**`ctas[]` schema:** `{ id, nom, banco, tipo, wal, saldo, cupo? }`
- `tipo` values: `'ahorros' | 'corriente' | 'cdt' | 'digital' | 'efectivo' | 'credito' | 'otro'`
- For `tipo === 'credito'` (credit card): `saldo` represents **debt owed** (positive = more debt). `cupo` (optional) is the credit limit.
- Credit cards are **liabilities** — they subtract from Total de Activos in `calcPat()`

**`wallets[]` schema:** `{ id: string, type: 'evm'|'btc'|'sol', label: string, address: string, chains: string[] }`
- `chains` only meaningful for `type === 'evm'`; empty array for BTC/SOL
- `migrateWallets(d)` auto-converts old format (`cryptoWallet`, `btcAddress`, `solAddress`) to `wallets[]` on load/syncDown

`ctaId` on transactions is `null` for unlinked entries or old data. The migration `txs.forEach(t => { if(t.ctaId===undefined) t.ctaId=null })` runs in both `load()` and `syncDown()`.

### Module-level variables (not in S)

```js
let polyPositions = [];     // fetched Polymarket positions (in-memory, not persisted)
let polyLoading = false;
let cryptoTokens = [];      // fetched crypto wallet tokens (in-memory, not persisted)
let cryptoLoading = false;
let _editId = null;         // id of transaction open in edit modal (null when closed)
let _toastTimer = null;     // debounce timer to prevent stacked toast notifications
let _undoTx = null;         // backup for the last deleted transaction (cleared after 5s or undo)
let _syncRetries = 0;       // consecutive syncUp failure count (reset on success)
let _syncRetryTimer = null; // handle for pending syncUp retry timeout
```

### Key Financial Formulas

- **Total de Activos** = Σ cuentas (COP equiv., credit cards subtracted) + Σ inversiones + Polymarket (USD×TRM) + Crypto (USD×TRM) — computed by `calcPat()`, returns `{ ctasCOP, invCOP, polyCOP, cryptoCOP, total }`
- **Efectivo en Cuentas** = `pat.ctasCOP` (non-credit accounts only)
- **Balance Neto** = `pat.total − gMcop` (Total Activos minus monthly expenses)
- **Tasa de Ahorro** = `(iMcop − gMcop) / iMcop × 100` — shown on dashboard when `iMcop > 0`
- **Rentabilidad inversión** = `(valor_actual − costo) / costo × 100`
- **TRM conversion** = `toCOP(amount, wallet)` → if wallet is USD, multiplies by `S.trm`

### XSS Safety

`esc(s)` escapes `& < > " '` before any user-controlled string is interpolated into `innerHTML`. All render functions that build HTML from `S` data (account names, descriptions, category names, wallet labels) must use `esc()`. Never interpolate raw user strings directly into template literals used with `.innerHTML`.

Entity IDs in `onclick` attributes must always be quoted: `onclick="delTx('${t.id}')"` — required because UUIDs contain hyphens which are invalid as bare JS expressions.

### TRM (Exchange Rate)

`autoTRM()` fetches in order until one succeeds:
1. **Primary:** `/api/trm?v={cacheBust}` — server-side proxy (no CORS, Frankfurt). The `v` param is a 30-minute time bucket (`Math.floor(Date.now()/1800000)`) that forces a fresh CDN response every 30 min on scheduled refreshes.
2. **Fallback 1:** `https://www.datos.gov.co/resource/mcec-87by.json` — direct client fetch
3. **Fallback 2:** `https://open.er-api.com/v6/latest/USD`
4. **Fallback 3:** `https://api.exchangerate-api.com/v4/latest/USD`

Uses `AbortSignal.timeout()` (no leaked timers). Auto-refreshes every 2 hours via `setInterval`. Label shows `"TRM Oficial · [date]"` on success. If **all** sources fail, `#tDot` turns red and `S.trmDate` is prefixed with `"⚠ Desactualizada"`.

**Two manual TRM entry paths:**
- **Dashboard chip** (`saveTRM()`) — reads `#trmInp`, toggles `S.trmOpen`
- **Ajustes tab** (`saveTRMaj()`) — reads `#aj-inp`

Both update `S.trm`, `S.trmMan`, `S.trmDate`, then call `persist()`, `updTRM()`, and `renderAll()`.

`updTRM()` refreshes all TRM display elements: `#tVal`, `#tDot` (dot color), `#aj-trm`, `#aj-src`.

### Movements → Account Linking

`#ctaSec` / `#ctaSel` is shown for **both** `gasto` and `ingreso`. The label (`#ctaSecLbl`) swaps:
- Ingreso: `"CUENTA QUE RECIBE EL INGRESO"`
- Gasto: `"CUENTA DE LA QUE SALE EL GASTO"`

All balance updates go through `_applyCtaImpact(tc, monto, walTx, tipo)`:

| tipo | cuenta normal | tarjeta de crédito |
|---|---|---|
| ingreso | `saldo += amt` | `saldo -= amt` (pago reduce deuda) |
| gasto | `saldo -= amt` | `saldo += amt` (gasto aumenta deuda) |

`delTx(id)` reverses the impact before removing the transaction. It also stores a backup in `_undoTx` and shows a 5-second toast with a **Deshacer** button. `undoDelTx()` restores both the transaction and the exact prior account balance from `_undoTx.prevSaldo`. `saveEditTx()` reverses the original impact then applies the new one.

Currency conversion in `_applyCtaImpact`:
- `amt = tc.wal === 'USD' ? (walTx === 'USD' ? monto : monto / S.trm) : toCOP(monto, walTx)`

`populateCtaSel()` rebuilds the dropdown and labels credit accounts with "Deuda: X" instead of their balance.

### Credit Card Accounts (`tipo: 'credito'`)

- `saldo` = debt owed (positive value)
- `cupo` (optional) = credit limit; available credit = `cupo - saldo`
- Shown in red with "Deuda:" label in Cuentas tab
- Excluded from the hero total in Cuentas (which shows assets, not liabilities)
- Subtract from `calcPat().ctasCOP` (liability treatment)
- Adding a credit account shows the optional `#cupoRow` field (toggled by `toggleCupoRow()`)

### Transaction Editing

`openEditModal(id)` opens a bottom-sheet overlay (`#edit-tx-modal`) pre-filled with the transaction's current data. Shows an account selector for **both** gastos and ingresos. `saveEditTx()` reverses the original account balance impact, updates all fields, then applies the new account impact. `_editId` tracks the active transaction. `closeEditModal()` resets it.

### Dashboard Navigation

Every widget on the Inicio tab is clickable and navigates to the relevant section. The helper `navBtn(page)` returns the correct `.nb` button element by index:
- `inicio=0, cuentas=1, movim=2, presup=3, invers=4, ajustes=5`

Clickable elements use `.card-click` CSS class or inline `onclick`. Always pass `navBtn('page')` when calling `go()` programmatically.

### Privacy System

Two layers of value hiding:

**Global (`S.privGlobal`):** Activated from Ajustes → PRIVACIDAD section. When `true`, replaces all monetary values with `••••` across every tab:
- Inicio: all dashboard widgets, composition card, recent transactions
- Movimientos: each transaction amount + monthly summary totals
- Cuentas: hero total, pills, each account balance
- Inversiones: investment names, cost→value, return %, COP equivalent, totals; also hides Polymarket and Crypto Wallet amounts
- Presupuesto: spent/budgeted/remaining amounts (percentages and bars stay visible)

**Per-widget (`S.priv[key]`):** Each card on Inicio has an individual 👁️ eye button. Keys: `tot` (hero + composition card), `cash`, `gm`, `bal`, `sav`, `topcat`. Independent of global.

**Helper functions:**
- `pv(key, val)` — returns `'••••'` if `privGlobal` or `priv[key]` is true, else returns `val`
- `isHid(key)` — returns boolean
- `togglePriv(key, e)` — toggles global or per-widget, calls `persist()` then `renderDash()`
- `updPrivBtns()` — syncs all eye button icons (👁️/🙈) and opacity to current state. Called at end of `renderDash()` and on init.

In render functions outside Inicio, use the local `const P = S.privGlobal` pattern for brevity.

### Currency

Two wallets: `COP` and `USD`. All totals are converted to COP for display using the live TRM.

### Desktop / Responsive Layout

The app uses CSS media query breakpoints:
- **≥ 768px:** App expands to 960px, sidebar nav replaces bottom tabs, Cuentas and Ajustes go 2-column, edit modal centers on screen
- **≥ 1100px:** App expands to 1140px, Inicio dashboard becomes 4-column
- **≥ 1280px:** App expands to 1280px, sidebar nav widens to 220px
- **≥ 1440px:** App expands to 1440px; Inicio becomes a 12-column grid; Movimientos splits into form (380px fixed) | list; Presupuesto goes 2-column; Inversiones goes 3-column
- **≥ 1920px:** App expands to 1600px

Viewport meta: `width=device-width, initial-scale=1, viewport-fit=cover` (no `maximum-scale` or `user-scalable` restrictions).

### Rendering

No virtual DOM. Each tab has a `render*()` function that directly sets `innerHTML` or `textContent`.

**`renderPage(p)`** renders only the components for the given page (replaces calling `renderAll()` on navigation):
- `'inicio'` → `renderDash()`
- `'cuentas'` → `renderCuentas()` + `populateCtaSel()`
- `'movim'` → `renderHist()` + `renderCG()` + `populateCtaSel()`
- `'presup'` → `renderBCfg()` + `renderBProg()`
- `'invers'` → `renderInv()`
- `'ajustes'` → `renderBioRow()` + `renderWalletList()` + `renderCatEdit()`

**`go(p, btn)`** activates the page, calls `renderPage(p)`, and calls `updTRM()`. Do **not** add `renderAll()` inside `go()`.

**`renderAll()`** calls every render function and is used only on: initial `load()`, `syncDown()`, `autoTRM()` success, and global privacy changes.

**`renderInv()` structure:** Renders three independent sections — manual investments, Polymarket, and Crypto Wallet. The manual investments section uses a normal early-`return` guard (`if(!el)return`). The Polymarket and Crypto sections follow it sequentially using `if/else` blocks without early returns, so both always render regardless of whether wallets are configured. Never add an early `return` between these sections.

**`renderDash()` is called by** `renderAll()`, `fetchPolymarket()`, and `fetchCryptoWallet()` — all three sources affect `calcPat()` totals, so all three must trigger a dashboard refresh.

### Transaction Search & Filters

Filter state lives in `S._uiFilters = { fw, fc, ft, txSearch }` — not in the DOM. `renderHist()` reads exclusively from `S._uiFilters`. HTML inputs write to `S._uiFilters` on `onchange`/`oninput` then call `renderHist()`. `chM()` clears `S._uiFilters.txSearch` and resets the `#txSearch` DOM value on month change.

### PWA / iOS

- App icon: `genIcon()` first tries to load `./logo.png`; if it fails (404 or network error), falls back to a canvas-generated 180×180 navy rounded square with white "MF". Result injected into `<link id="ati">` and `#appLogo`.
- `logo.png` is committed to the repo (whitelisted in `.gitignore` via `!logo.png`). It is a **180×180 px PNG** cropped from the original `Logo App mis propias finanzas.png` (1536×1024) — do not re-export the original directly, always crop to square first. Source file remains PC-only per gitignore rules.
- Logo box CSS: `.logo-box { background: #F5F4F0 }` — matches the logo's own cream background. `#appLogo { width:100%; height:100%; object-fit:cover }` fills the box edge-to-edge.
- `theme-color` meta tags for light/dark mode.
- `apple-mobile-web-app-status-bar-style: black-translucent` — `.topbar` uses `padding-top: calc(14px + env(safe-area-inset-top))`.
- Inline manifest sets `display: standalone`.
- Service worker (`sw.js`) enables offline loading after first visit.

### iOS PWA Auth Flow (OTP)

Login uses **6-digit OTP codes** (not magic links) to avoid the PKCE verifier mismatch that occurs when iOS opens links in Safari instead of the PWA.

**Flow:**
1. User enters email → `sendMagicLink()` calls `supa.auth.signInWithOtp()` with `shouldCreateUser: true`
2. Email input and send button are hidden; `#login-sent` card appears with a 6-digit input (`#login-otp`)
3. User enters the code → `verifyOtp()` calls `supa.auth.verifyOtp({email, token, type:'email'})`
4. On success, `onAuthStateChange` fires automatically and calls `hideLogin()`
5. `backToEmail()` lets the user go back if needed

**Supabase dashboard requirement:** the "Magic Link" email template must include `{{ .Token }}` in the body so Supabase sends the code alongside the link.

The `visibilitychange` listener is kept as a fallback session recovery mechanism (useful for expired sessions).

### Categories

Default categories are defined in `DC[]`. Users can add/delete custom categories in Ajustes. Deleting a category also cleans up its budget entries in `S.bud.COP` and `S.bud.USD`.

### Supabase Sync (Cloud Backend)

Data is synced to Supabase for cross-device persistence and protection against Safari localStorage purge.

**Credentials (public/anon — safe to commit):**
- Project URL: `https://ukqruxdknpaljxndyswl.supabase.co`
- Anon key: `sb_publishable_8n5K25ZY4xZWX3bTprZ81w_3H2_-1Tp`

**Supabase table schema:**
```sql
finanzas_data (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  data    jsonb,        -- full S state serialized as JSON
  updated_at timestamptz
)
```
Row Level Security is enabled — users can only read/write their own row.

**Sync flow:**
- `persist()` → saves to `localStorage` immediately via `buildPersistPayload()`, then calls `debouncedSyncUp()` (1.5s debounce) → `syncUp()` upserts full state to Supabase
- On app open → `supa.auth.getSession()` checks for existing session → calls `syncDown()` which fetches the cloud row, overwrites `S`, writes localStorage, then calls `renderAll()`
- Offline: `syncUp()` fails and retries automatically at 10s → 30s → 60s backoff (counter resets on success)
- Sync status dot (`#sync-dot`) in topbar managed by `setSyncDot(state)`: `'ok'` → green, `'busy'` → amber, `'err'` → red ("Error de sync — reintentando"), anything else → muted (no session)

**Fields synced** (managed via `PERSIST_KEYS`):
`txs, ctas, invs, cats, bud, trm, trmMan, trmDate, privGlobal, priv, polyWallet, wallets`

**Key functions:**
- `syncUp()` — async, upserts via `buildPersistPayload()`; retries with exponential backoff on failure
- `syncDown()` — async, fetches cloud state, stringifies any legacy numeric IDs, overwrites `S` + localStorage, calls `renderAll()`, then fetches Polymarket/crypto if configured
- `debouncedSyncUp()` — 1500ms debounced wrapper called by `persist()`
- `sendMagicLink()` — sends 6-digit OTP via `supa.auth.signInWithOtp()`
- `verifyOtp()` — verifies 6-digit code via `supa.auth.verifyOtp()`
- `doSignOut()` — signs out and shows login overlay; does **not** clear the biometric credential
- `showLogin()` / `hideLogin()` — controls `#login-overlay` visibility; `showLogin()` also shows/hides `#bio-login-sec` based on `hasBioCred()`

**Login overlay** (`#login-overlay`): full-screen overlay shown when `supaUser` is null. Shows email input + send button initially; after sending shows `#login-sent` card with OTP input, Verificar button, and "← Volver" link. Contains a biometric section (`#bio-login-sec`) shown only when a credential is registered on the device.

**`resetApp()`:** resets `txs`, `invs`, `ctas`, `bud`, `cats`, `privGlobal`, `priv` to empty/defaults and writes localStorage. Does **not** reset `polyWallet`, `wallets`, or the biometric credential — those survive a reset. Deletes the Supabase row to prevent cloud restore on next sync. Auth session stays active.

**Operational note:** Supabase free tier pauses after 7 days of inactivity. Data is not lost — reactivate from the Supabase dashboard.

### Biometric Auth (Face ID / Touch ID)

Device-local authentication via the **WebAuthn API** (platform authenticator). The biometric credential is registered once per device after the first sign-in.

**Key functions:**
- `hasBioCred()` — returns `true` if `localStorage['mf_bio']` exists
- `bioAvailable()` — async, returns `true` if `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` resolves true
- `registerBiometric()` — calls `navigator.credentials.create()` with `authenticatorAttachment: 'platform'`; stores `{ id: Uint8Array, email }` in `localStorage['mf_bio']`
- `authWithBiometric()` — verifies biometric via `navigator.credentials.get()`; checks that `session.user.email === bio.email` before granting access (prevents a different user's session from unlocking); tries `getSession()` then `refreshSession()` to restore the Supabase session
- `revokeBiometric()` — removes `localStorage['mf_bio']` and re-renders the settings row
- `renderBioRow()` — renders the Activate/Revocar row in Ajustes → CUENTA (`#bio-row`); disables the button if `bioAvailable()` returns false

**Storage:** `localStorage['mf_bio']` = `{ id: number[], email: string }` — the credential ID (public, non-sensitive) and email. No biometric data ever leaves the device's Secure Enclave.

**Credential scope:** credentials are bound to `window.location.hostname` (the `rp.id`). A credential registered on Vercel won't work on GitHub Pages and vice versa — this is correct WebAuthn behaviour.

### Polymarket Integration

Displays the user's open prediction market positions in **Inversiones → POLYMARKET**.

- `S.polyWallet` — the user's Polymarket proxy wallet address (set in Ajustes → POLYMARKET)
- `fetchPolymarket(showToast?)` — calls `/api/polymarket?user={polyWallet}`, stores results in `polyPositions[]`, calls `renderInv()` **and `renderDash()`** (totals update)
- `savePolyWallet()` — validates and saves the wallet address, triggers fetch
- Data: market title, `outcome` (e.g. `"YES"` / `"NO"` — rendered as a badge if present), initial value, current value, P&L in USD and COP
- Auto-fetches on app load and after `syncDown()`

**Note:** Polymarket is blocked in Colombia and the US at the website level, but the Data API (read-only) is not geo-restricted. The Vercel proxy in Frankfurt ensures reliable access.

### Crypto Wallet Integration

Displays real-time crypto token balances in **Inversiones → CRYPTO WALLET**.

- `S.wallets[]` — list of configured wallets `{ id, type, label, address, chains }`
- `fetchCryptoWallet(showToast?)` — queries `/api/wallet-balance` for each wallet in parallel, combines tokens into `cryptoTokens[]`, calls `renderInv()` **and `renderDash()`** (totals update). Per-wallet errors are surfaced via toast instead of being silently swallowed.
- `addWallet()` — validates and adds a wallet to `S.wallets`, persists, triggers fetch
- `delWallet(id)` — removes wallet, clears `cryptoTokens`, re-fetches remaining
- `renderWalletList()` — renders the wallet list in Ajustes → CRYPTO WALLETS
- `toggleWType()` — shows/hides EVM chain checkboxes in the add-wallet form

**Data sources by chain type:**

| Type | Balance source | Price source | API key |
|---|---|---|---|
| EVM (eth/polygon/bsc/base/avalanche) | Moralis EVM API | Moralis → Binance fallback | `MORALIS_KEY` in Vercel |
| Bitcoin | mempool.space | Binance public | None |
| Solana + SPL tokens | Moralis Solana gateway | Moralis / Binance | `MORALIS_KEY` in Vercel |

**Migration:** `migrateWallets(d)` converts old single-address fields (`cryptoWallet`, `btcAddress`, `solAddress`) to the `wallets[]` array format automatically on `load()` and `syncDown()`.

**Token shape in `cryptoTokens[]`:** `{ name, symbol, logo, balance, chain, usd_value, walletLabel }` — `walletLabel` is injected by `fetchCryptoWallet()` from the matching entry in `S.wallets`. Native tokens are kept even when `usd_value === 0` (price feed unavailable). Non-native tokens kept if `usd_value > 0.01` or `balance >= 0.001`. Sorted descending by value.

**Display:** Each token shows logo, name, symbol, balance, wallet label, chain, USD value, and COP equivalent. All amounts hidden when `S.privGlobal` is true.

**`addInv()` note:** Zero (`0`) is a valid cost or value (e.g. an airdrop). Validation rejects empty strings and negative numbers, but accepts `0`.

## Currency & Locale

- Amounts in COP formatted with `fCOP(n)` → `'$' + Math.round(n).toLocaleString('es-CO')`
- Amounts in USD formatted with `fUSD(n)` → `toLocaleString('en-US', {min/maxFractionDigits: 0/2})`
- Dates parsed with `T12:00:00` suffix to avoid timezone shifts

## Excel Export

The `xlsx` library (~1MB) is **lazy-loaded** on first use — it is not included in the initial page load. `expXL()` is `async` and dynamically injects the CDN script tag on first click, then proceeds with the export. Exports 5 sheets: Cuentas, Transacciones (includes "Cuenta" column), Presupuesto, Inversiones, Resumen.
