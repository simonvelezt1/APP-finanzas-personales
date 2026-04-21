# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Mis Finanzas** — A personal finance management app for a Colombian user. Single self-contained `index.html` file with no build step, no dependencies, and no framework. Everything (HTML, CSS, JS) lives in one file. Serverless API functions live in `api/`.

## Deployment

- **GitHub:** `https://github.com/simonvelezt1/APP-finanzas-personales`
- **Vercel (live):** `https://app-finanzas-personales-mu.vercel.app`
- **GitHub Pages:** `https://simonvelezt1.github.io/APP-finanzas-personales/`

Any edit to `index.html` auto-commits and pushes to GitHub via a PostToolUse hook (`.claude/settings.json`). Vercel and GitHub Pages both auto-deploy on push. `vercel.json` sets `Cache-Control: no-cache` on the HTML so browsers always fetch the latest version.

**Sync rule:** GitHub, Vercel and Supabase must always be in sync. `index.html` edits auto-push via the PostToolUse hook. Changes to other **tracked** files (e.g. `vercel.json`, `CLAUDE.md`, `api/*.js`) must be committed and pushed manually: `git add <file> && git commit && git push`.

## What lives where

| File | GitHub | PC only | Why |
|---|---|---|---|
| `index.html` | ✅ auto-push | | The app |
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

The app is `index.html` + three Vercel API proxy functions in `api/`. There is no build process.

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
- Native tokens (ETH, BNB, AVAX, SOL, BTC) kept even when USD price is unavailable (`usd_value: 0`)
- CORS: restricted to the production Vercel/GitHub Pages origins

#### `api/trm.js`
- Proxies TRM (USD→COP) from 3 sources server-side (avoids client CORS issues)
- Returns `{ trm, date, source }` on success; `{ error, details }` on failure
- Sources tried in order: Banco de la República → open.er-api.com → exchangerate-api.com
- Cache: `s-maxage=3600, stale-while-revalidate=86400`
- No API key required

### Security Headers (`vercel.json`)

Applied to all routes via `vercel.json`:
- `Content-Security-Policy` — restricts scripts, images, connect sources to known-good origins
- `X-Frame-Options: DENY` — blocks clickjacking
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### State

A single global object `S` holds all runtime state. It is persisted to `localStorage` under the key `mf_v1`. On load, it also tries legacy keys (`fin_v5`, `fin_v4`, `fin_v3`) for backwards compatibility.

```js
S = {
  trm,            // USD→COP exchange rate (default 4200)
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
}
```

**`ctas[]` schema:** `{ id, nom, banco, tipo, wal, saldo, cupo? }`
- `tipo` values: `'ahorros' | 'corriente' | 'cdt' | 'digital' | 'efectivo' | 'credito' | 'otro'`
- For `tipo === 'credito'` (credit card): `saldo` represents **debt owed** (positive = more debt). `cupo` (optional) is the credit limit.
- Credit cards are **liabilities** — they subtract from Total de Activos in `calcPat()`

**`wallets[]` schema:** `{ id: number, type: 'evm'|'btc'|'sol', label: string, address: string, chains: string[] }`
- `chains` only meaningful for `type === 'evm'`; empty array for BTC/SOL
- `migrateWallets(d)` auto-converts old format (`cryptoWallet`, `btcAddress`, `solAddress`) to `wallets[]` on load/syncDown

`persist()` saves all fields above (except `trmOpen` and `editCta`) to `localStorage` and calls `debouncedSyncUp()`. The `localStorage` format and the Supabase payload must always match — add new fields to both simultaneously.

`ctaId` on transactions is `null` for unlinked entries or old data. The migration `txs.forEach(t => { if(t.ctaId===undefined) t.ctaId=null })` runs in both `load()` and `syncDown()` — intentional so the fix applies regardless of which source loads the data.

### Module-level variables (not in S)

```js
let polyPositions = [];   // fetched Polymarket positions (in-memory, not persisted)
let polyLoading = false;
let cryptoTokens = [];    // fetched crypto wallet tokens (in-memory, not persisted)
let cryptoLoading = false;
let _editId = null;       // id of transaction open in edit modal (null when closed)
let _toastTimer = null;   // debounce timer to prevent stacked toast notifications
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

### TRM (Exchange Rate)

`autoTRM()` fetches in order until one succeeds:
1. **Primary:** `/api/trm` — server-side proxy (no CORS, Frankfurt, cached)
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

`delTx(id)` reverses the impact by calling `_applyCtaImpact` with the opposite `tipo`. `saveEditTx()` reverses the original impact then applies the new one.

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

The app uses media queries at two breakpoints:
- **≥ 768px:** App expands to 960px, dashboard grid becomes 3-column, Cuentas and Ajustes go 2-column, edit modal centers on screen
- **≥ 1100px:** App expands to 1140px, Inicio dashboard becomes 4-column

No changes to the viewport meta tag — CSS alone handles responsive behavior.

### Rendering

No virtual DOM. Each tab has a `render*()` function that directly sets `innerHTML` or `textContent`. `renderAll()` refreshes everything. Navigation calls `go(page, btn)`.

**`renderInv()` structure:** Renders three independent sections — manual investments, Polymarket, and Crypto Wallet. The manual investments section uses a normal early-`return` guard (`if(!el)return`). The Polymarket and Crypto sections follow it sequentially using `if/else` blocks without early returns, so both always render regardless of whether wallets are configured. Never add an early `return` between these sections.

**`renderDash()` is called by** `renderAll()`, `fetchPolymarket()`, and `fetchCryptoWallet()` — all three sources affect `calcPat()` totals, so all three must trigger a dashboard refresh.

### Transaction Search

`renderHist()` reads `#txSearch` value and filters by description or category name (case-insensitive). `chM()` (month navigation) clears the search field automatically on month change.

### PWA / iOS

- App icon: `genIcon()` first tries to load `./logo.png`; if it fails (404 or network error), falls back to a canvas-generated 180×180 green rounded square with white "MF". Result injected into `<link id="ati">` and `#appLogo`.
- `logo.png` is committed to the repo (whitelisted in `.gitignore` via `!logo.png`) so it's available on Vercel.
- `theme-color` meta tags for light/dark mode.
- `apple-mobile-web-app-status-bar-style: black-translucent` — `.topbar` uses `padding-top: calc(14px + env(safe-area-inset-top))`.
- Inline manifest sets `display: standalone`.

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

**Auth:** Magic link (email OTP). `signInWithOtp()` sends a link; clicking it redirects to the app URL and `onAuthStateChange` fires, setting `supaUser` and calling `syncDown()`.

**Sync flow:**
- `persist()` → saves to `localStorage` immediately, then calls `debouncedSyncUp()` (1.5 s debounce) → `syncUp()` upserts full state to Supabase
- On app open → `supa.auth.getSession()` checks for existing session → calls `syncDown()` which fetches the cloud row, overwrites `S`, writes localStorage, then calls `renderAll()`
- Offline: `syncUp()` fails silently; `localStorage` keeps the data; syncs when connectivity returns
- Sync status dot (`#sync-dot`) in topbar managed by `setSyncDot(state)`: `'ok'` → green, `'busy'` → amber, anything else → muted (no session or error)

**Fields synced (both `syncUp` and `syncDown` must include all of these):**
`txs, ctas, invs, cats, bud, trm, trmMan, trmDate, privGlobal, priv, polyWallet, wallets`

**Key functions:**
- `syncUp()` — async, upserts full state to Supabase
- `syncDown()` — async, fetches cloud state, overwrites `S` fields + localStorage, calls `renderAll()`, then calls `fetchPolymarket()` and `fetchCryptoWallet()` if configured
- `debouncedSyncUp()` — 1500ms debounced wrapper called by `persist()`
- `sendMagicLink()` — sends OTP email via `supa.auth.signInWithOtp()`
- `doSignOut()` — signs out and shows login overlay
- `showLogin()` / `hideLogin()` — controls `#login-overlay` visibility

**Login overlay** (`#login-overlay`): full-screen overlay shown when `supaUser` is null.

**`resetApp()`:** resets `txs`, `invs`, `ctas`, `bud`, `cats` to empty/defaults and writes localStorage. Does **not** reset `polyWallet` or `wallets` — those survive a reset. Deletes the Supabase row to prevent cloud restore on next sync. Auth session stays active.

**Operational note:** Supabase free tier pauses after 7 days of inactivity. Data is not lost — reactivate from the Supabase dashboard.

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
| EVM (eth/polygon/bsc/base/avalanche) | Moralis EVM API | Moralis | `MORALIS_KEY` in Vercel |
| Bitcoin | mempool.space | Binance public | None |
| Solana + SPL tokens | Moralis Solana gateway | Moralis / Binance | `MORALIS_KEY` in Vercel |

**Migration:** `migrateWallets(d)` converts old single-address fields (`cryptoWallet`, `btcAddress`, `solAddress`) to the `wallets[]` array format automatically on `load()` and `syncDown()`.

**Token shape in `cryptoTokens[]`:** `{ name, symbol, logo, balance, chain, usd_value, walletLabel }` — `walletLabel` is injected by `fetchCryptoWallet()` from the matching entry in `S.wallets`. Native tokens are kept even when `usd_value === 0` (price feed unavailable). Non-native tokens filtered to `usd_value > 0.01`. Sorted descending by value.

**Display:** Each token shows logo, name, symbol, balance, wallet label, chain, USD value, and COP equivalent. All amounts hidden when `S.privGlobal` is true.

**`addInv()` note:** Zero (`0`) is a valid cost or value (e.g. an airdrop). Validation rejects empty strings and negative numbers, but accepts `0`.

## Currency & Locale

- Amounts in COP formatted with `fCOP(n)` → `'$' + Math.round(n).toLocaleString('es-CO')`
- Amounts in USD formatted with `fUSD(n)` → `toLocaleString('en-US', {min/maxFractionDigits: 0/2})`
- Dates parsed with `T12:00:00` suffix to avoid timezone shifts

## Excel Export

Uses the `xlsx` library loaded from CDN (`cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js`). Exports 5 sheets: Cuentas, Transacciones (includes "Cuenta" column), Presupuesto, Inversiones, Resumen.
