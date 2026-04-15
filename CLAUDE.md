# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Mis Finanzas** — A personal finance management app for a Colombian user. Single self-contained `index.html` file with no build step, no dependencies, and no framework. Everything (HTML, CSS, JS) lives in one file.

## Deployment

- **GitHub:** `https://github.com/simonvelezt1/APP-finanzas-personales`
- **Vercel (live):** `https://app-finanzas-personales-mu.vercel.app`
- **GitHub Pages:** `https://simonvelezt1.github.io/APP-finanzas-personales/`

Any edit to `index.html` auto-commits and pushes to GitHub via a PostToolUse hook (`.claude/settings.json`). Vercel and GitHub Pages both auto-deploy on push. `vercel.json` sets `Cache-Control: no-cache` on the HTML so browsers always fetch the latest version.

**Sync rule:** GitHub, Vercel and Supabase must always be in sync. `index.html` edits auto-push via the PostToolUse hook. Changes to other **tracked** files (e.g. `vercel.json`, `CLAUDE.md`) must be committed and pushed manually: `git add <file> && git commit && git push`.

## What lives where

| File | GitHub | PC only | Why |
|---|---|---|---|
| `index.html` | ✅ auto-push | | The app |
| `vercel.json` | ✅ manual push | | Deployment config |
| `CLAUDE.md` | ✅ manual push | | Architecture docs |
| `.gitignore` | ✅ manual push | | Protects local files |
| `.claude/settings.json` | ✅ manual push | | PostToolUse hook (needed for auto-commit to work) |
| `.claude/launch.json` | ✅ manual push | | Local dev server config |
| `.claude/settings.local.json` | 🚫 never | ✅ | Personal permissions — gitignored |
| `.claude/plans/` | 🚫 never | ✅ | Work-in-progress plans — gitignored |
| `*.png / *.jpg` | 🚫 never | ✅ | Personal images — gitignored |

**Rule:** Never use `git add .` or `git add -A` — always add files by name to avoid accidentally pushing personal files.

## Architecture

The entire app is `index.html`. There is no build process — edit the file and it's done.

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
  ctas[],         // accounts: { id, nom, banco, tipo, wal, saldo }
  cats[],         // categories: { id, n, i }
  bud: { general, COP: {catId: amount}, USD: {catId: amount} },
  cat, wal, tipo, bWal, iWal, cWal,   // UI selections
  vm, vy, bm, by,                      // month/year for history and budget views
  editCta,        // id of account currently being inline-edited (null otherwise)
  privGlobal,     // boolean — global privacy mode (hides all monetary values app-wide)
  priv: {}        // per-widget privacy: { tot, cash, gm, bal, sav, topcat } → boolean
}
```

`persist()` saves all fields above (except `trmOpen` and `editCta`) to `localStorage` and calls `debouncedSyncUp()`. The `localStorage` format and the Supabase payload must always match — add new fields to both simultaneously.

`ctaId` on transactions is `null` for unlinked entries or old data. The migration in `load()` sets `ctaId = null` on any existing transaction missing the field.

### Key Financial Formulas

- **Total de Activos** = Σ cuentas (COP equiv.) + Σ inversiones (valor actual en COP) — computed by `calcPat()`, returns `{ ctasCOP, invCOP, total }`
- **Efectivo en Cuentas** = `pat.ctasCOP` (accounts only, no investments)
- **Balance Neto** = `pat.total − gMcop` (Total Activos minus monthly expenses)
- **Tasa de Ahorro** = `(iMcop − gMcop) / iMcop × 100` — shown on dashboard when `iMcop > 0`
- **Rentabilidad inversión** = `(valor_actual − costo) / costo × 100`
- **TRM conversion** = `toCOP(amount, wallet)` → if wallet is USD, multiplies by `S.trm`

### TRM (Exchange Rate)

`autoTRM()` fetches in order until one succeeds:
1. **Primary:** `https://www.datos.gov.co/resource/mcec-87by.json` — official TRM from Banco de la República (Colombia)
2. **Fallback 1:** `https://open.er-api.com/v6/latest/USD`
3. **Fallback 2:** `https://api.exchangerate-api.com/v4/latest/USD`

Uses `AbortSignal.timeout()` (no leaked timers). Auto-refreshes every 2 hours via `setInterval`. Label shows `"TRM Oficial · [date]"` on success.

### Income → Account Linking

When `S.tipo === 'ingreso'`, a dropdown (`#ctaSec` / `#ctaSel`) lets the user assign the income to a specific account. On `reg()`, if a `ctaId` is selected, `targetCta.saldo` is updated immediately with currency conversion:
- USD income → USD account: `saldo += monto`
- COP income → COP account: `saldo += monto`
- COP income → USD account: `saldo += monto / S.trm`
- USD income → COP account: `saldo += monto * S.trm`

`populateCtaSel()` rebuilds the dropdown. `onCtaSelChange()` intercepts the "Crear nueva cuenta" option and navigates to the Cuentas tab.

### Transaction Editing

`openEditModal(id)` opens a bottom-sheet overlay (`#edit-tx-modal`) pre-filled with the transaction's current data. `saveEditTx()` reverses the original account balance impact (if the transaction was income linked to an account), updates all fields, then applies the new account impact. `_editId` tracks the active transaction. `closeEditModal()` resets it.

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
- Inversiones: investment names, cost→value, return %, COP equivalent, totals
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

### Rendering

No virtual DOM. Each tab has a `render*()` function that directly sets `innerHTML` or `textContent`. `renderAll()` refreshes everything. Navigation calls `go(page, btn)`.

### Transaction Search

`renderHist()` reads `#txSearch` value and filters by description or category name (case-insensitive). `chM()` (month navigation) clears the search field automatically on month change.

### PWA / iOS

- App icon generated at runtime via `genIcon()` (canvas 180×180, green rounded square, white "MF") injected into `<link id="ati">` and `#appLogo`.
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
- Sync status dot (`#sync-dot`) in topbar: green = synced, amber = busy, muted = no session

**Fields synced (both `syncUp` and `syncDown` must include all of these):**
`txs, ctas, invs, cats, bud, trm, trmMan, trmDate, privGlobal, priv`

**Key functions:**
- `syncUp()` — async, upserts full state to Supabase
- `syncDown()` — async, fetches cloud state, overwrites `S` fields + localStorage, calls `renderAll()`
- `debouncedSyncUp()` — 1500ms debounced wrapper called by `persist()`
- `sendMagicLink()` — sends OTP email via `supa.auth.signInWithOtp()`
- `doSignOut()` — signs out and shows login overlay
- `showLogin()` / `hideLogin()` — controls `#login-overlay` visibility

**Login overlay** (`#login-overlay`): full-screen overlay shown when `supaUser` is null.

**`resetApp()`:** resets `S` to empty state, writes localStorage (with `privGlobal:false, priv:{}`), deletes the Supabase row to prevent cloud restore on next sync.

**Operational note:** Supabase free tier pauses after 7 days of inactivity. Data is not lost — reactivate from the Supabase dashboard.

## Currency & Locale

- Amounts in COP formatted with `fCOP(n)` → `'$' + Math.round(n).toLocaleString('es-CO')`
- Amounts in USD formatted with `fUSD(n)` → `toLocaleString('en-US', {min/maxFractionDigits: 0/2})`
- Dates parsed with `T12:00:00` suffix to avoid timezone shifts

## Excel Export

Uses the `xlsx` library loaded from CDN (`cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js`). Exports 5 sheets: Cuentas, Transacciones (includes "Cuenta" column), Presupuesto, Inversiones, Resumen.
