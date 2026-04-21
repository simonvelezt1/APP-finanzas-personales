// Proxy para leer balances de wallets cripto.
// Soporta: EVM chains (Moralis), Bitcoin (mempool.space + Binance), Solana (Moralis).
// La API key nunca sale del servidor. Corre en Frankfurt (fra1).

export const config = { regions: ['fra1'] };

const MORALIS_KEY = process.env.MORALIS_KEY;
const BASE_EVM = 'https://deep-index.moralis.io/api/v2.2';
const BASE_SOL = 'https://solana-gateway.moralis.io';

const ALLOWED_ORIGINS = [
  'https://app-finanzas-personales-mu.vercel.app',
  'https://simonvelezt1.github.io',
];

function setCORS(req, res) {
  const origin = req.headers.origin || '';
  const allowed =
    ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)
      ? origin
      : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
}

const NATIVE = {
  eth:      { symbol: 'ETH',  name: 'Ethereum',  decimals: 18 },
  polygon:  { symbol: 'POL',  name: 'Polygon',   decimals: 18 },
  bsc:      { symbol: 'BNB',  name: 'BNB Chain', decimals: 18 },
  base:     { symbol: 'ETH',  name: 'Base',      decimals: 18 },
  avalanche:{ symbol: 'AVAX', name: 'Avalanche', decimals: 18 },
};

// ── EVM (Ethereum, Polygon, BNB, Base, Avalanche) ──────────────────────────

async function moralisEVM(path, chain) {
  const url = `${BASE_EVM}${path}${path.includes('?') ? '&' : '?'}chain=${chain}`;
  const r = await fetch(url, {
    headers: { 'X-API-Key': MORALIS_KEY, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`Moralis EVM ${r.status}`);
  return r.json();
}

async function getEVMBalances(address, chain) {
  const [nativeRaw, tokensRaw] = await Promise.all([
    moralisEVM(`/${address}/balance`, chain),
    moralisEVM(`/${address}/erc20?limit=100`, chain),
  ]);
  const results = [];
  const nativeInfo = NATIVE[chain] || { symbol: chain.toUpperCase(), name: chain, decimals: 18 };
  const nativeBal = parseFloat(nativeRaw.balance || '0') / 10 ** nativeInfo.decimals;

  // Keep native tokens even without USD price — show balance with usd_value: 0
  if (nativeBal > 0.000001) {
    const usdPrice = nativeRaw.usd_price || null;
    results.push({
      symbol: nativeInfo.symbol, name: nativeInfo.name, balance: nativeBal,
      usd_price: usdPrice,
      usd_value: nativeBal * (usdPrice || 0),
      logo: null, native: true, chain,
    });
  }
  for (const t of (tokensRaw || [])) {
    const bal = parseFloat(t.balance || '0') / 10 ** (t.decimals || 18);
    if (bal < 0.000001) continue;
    const usdVal = t.usd_value != null ? parseFloat(t.usd_value) : bal * (parseFloat(t.usd_price) || 0);
    results.push({
      symbol: t.symbol || '?', name: t.name || t.symbol || '?', balance: bal,
      usd_price: t.usd_price != null ? parseFloat(t.usd_price) : null,
      usd_value: usdVal, logo: t.logo || t.thumbnail || null, native: false, chain,
    });
  }
  return results;
}

// ── Bitcoin ────────────────────────────────────────────────────────────────

async function getBitcoinBalance(address) {
  const [addrData, priceData] = await Promise.all([
    fetch(`https://mempool.space/api/address/${address}`, { signal: AbortSignal.timeout(10000) }).then(r => {
      if (!r.ok) throw new Error(`mempool ${r.status}`);
      return r.json();
    }),
    fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', {
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json()).catch(() => ({ price: 0 })),
  ]);

  const confirmed   = (addrData.chain_stats?.funded_txo_sum  || 0) - (addrData.chain_stats?.spent_txo_sum  || 0);
  const unconfirmed = (addrData.mempool_stats?.funded_txo_sum || 0) - (addrData.mempool_stats?.spent_txo_sum || 0);
  const satoshis    = confirmed + unconfirmed;
  const btcBalance  = satoshis / 1e8;
  const btcPrice    = parseFloat(priceData.price || 0);
  const usdValue    = btcBalance * btcPrice;

  // Show BTC balance even if 0 (address exists)
  if (btcBalance < 0.000001) return [];
  return [{
    symbol: 'BTC', name: 'Bitcoin', balance: btcBalance,
    usd_price: btcPrice, usd_value: usdValue,
    logo: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
    native: true, chain: 'bitcoin',
  }];
}

// ── Solana ─────────────────────────────────────────────────────────────────

async function moralisSOL(path) {
  const url = `${BASE_SOL}${path}`;
  const r = await fetch(url, {
    headers: { 'X-API-Key': MORALIS_KEY, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`Moralis SOL ${r.status}`);
  return r.json();
}

async function getSolanaBalances(address) {
  const [solData, splData] = await Promise.all([
    moralisSOL(`/account/mainnet/${address}/balance`),
    moralisSOL(`/account/mainnet/${address}/tokens`),
  ]);

  const results = [];
  const solBalance = parseFloat(solData.solana || 0);
  if (solBalance > 0.000001) {
    const priceData = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', {
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json()).catch(() => ({ price: 0 }));
    const solPrice = parseFloat(priceData.price || 0);
    results.push({
      symbol: 'SOL', name: 'Solana', balance: solBalance,
      usd_price: solPrice, usd_value: solBalance * solPrice,
      logo: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
      native: true, chain: 'solana',
    });
  }

  for (const t of (splData || [])) {
    const bal = parseFloat(t.amount || 0);
    if (bal < 0.000001) continue;
    const usdVal = parseFloat(t.usd_value || 0);
    if (usdVal < 0.01) continue;
    results.push({
      symbol: t.symbol || '?', name: t.name || t.symbol || '?', balance: bal,
      usd_price: usdVal > 0 && bal > 0 ? usdVal / bal : null,
      usd_value: usdVal,
      logo: t.logo || null, native: false, chain: 'solana',
    });
  }
  return results;
}

// ── Handler principal ──────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    return res.status(204).end();
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { address, chains = 'eth,polygon', btcAddress, solAddress } = req.query;

  // BTC doesn't need MORALIS_KEY — check key only when needed
  const needsMoralis = address || solAddress;
  if (needsMoralis && !MORALIS_KEY) {
    // If there's also a BTC address, still try that
    if (!btcAddress) {
      return res.status(500).json({ error: 'MORALIS_KEY no configurada en Vercel → ve a Settings → Environment Variables' });
    }
  }

  const tasks = [];
  const taskLabels = []; // for error reporting

  // EVM chains
  if (address && MORALIS_KEY) {
    if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) {
      return res.status(400).json({ error: 'Dirección EVM inválida' });
    }
    const chainList = chains.split(',').map(c => c.trim()).filter(c => NATIVE[c]).slice(0, 5);
    if (!chainList.length) {
      return res.status(400).json({ error: 'Ninguna chain EVM válida. Usa: eth, polygon, bsc, base, avalanche' });
    }
    chainList.forEach(c => {
      tasks.push(getEVMBalances(address, c));
      taskLabels.push(`evm:${c}`);
    });
  }

  // Bitcoin (no key needed)
  if (btcAddress) {
    if (!/^(bc1[a-z0-9]{39,59}|[13][a-zA-HJ-NP-Z0-9]{24,33})$/.test(btcAddress)) {
      return res.status(400).json({ error: 'Dirección Bitcoin inválida' });
    }
    tasks.push(getBitcoinBalance(btcAddress));
    taskLabels.push('bitcoin');
  }

  // Solana
  if (solAddress && MORALIS_KEY) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solAddress)) {
      return res.status(400).json({ error: 'Dirección Solana inválida' });
    }
    tasks.push(getSolanaBalances(solAddress));
    taskLabels.push('solana');
  }

  if (!tasks.length) return res.status(400).json({ error: 'No se proporcionó ninguna dirección válida' });

  const results = await Promise.allSettled(tasks);

  const tokens = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    // Show native tokens even with 0 USD value; filter non-native by value
    .filter(t => t.native ? t.balance > 0.000001 : t.usd_value > 0.01)
    .sort((a, b) => b.usd_value - a.usd_value);

  const errors = results
    .map((r, i) => r.status === 'rejected' ? { source: taskLabels[i], message: r.reason?.message || 'Error desconocido' } : null)
    .filter(Boolean);

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  return res.status(200).json({ tokens, errors });
}
