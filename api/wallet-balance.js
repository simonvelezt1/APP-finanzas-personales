// Proxy hacia Moralis para leer balances de tokens de una wallet.
// La API key nunca sale del servidor — el cliente solo ve /api/wallet-balance.
// Corre en Frankfurt (fra1) para mejor latencia y sin bloqueos geo.

const MORALIS_KEY = process.env.MORALIS_KEY;
const BASE = 'https://deep-index.moralis.io/api/v2.2';

const NATIVE = {
  eth:     { symbol: 'ETH',  name: 'Ethereum',  decimals: 18 },
  polygon: { symbol: 'POL',  name: 'Polygon',   decimals: 18 },
  bsc:     { symbol: 'BNB',  name: 'BNB Chain', decimals: 18 },
  base:    { symbol: 'ETH',  name: 'Base',       decimals: 18 },
  avalanche:{ symbol: 'AVAX',name: 'Avalanche',  decimals: 18 },
};

async function moralis(path, chain) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}chain=${chain}`;
  const r = await fetch(url, {
    headers: { 'X-API-Key': MORALIS_KEY, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Moralis ${r.status}`);
  return r.json();
}

async function getChainBalances(address, chain) {
  // Llamadas en paralelo: balance nativo + tokens ERC-20
  const [nativeRaw, tokensRaw] = await Promise.all([
    moralis(`/${address}/balance`, chain),
    moralis(`/${address}/erc20?limit=100`, chain),
  ]);

  const results = [];

  // Token nativo (ETH, POL, BNB…)
  const nativeInfo = NATIVE[chain] || { symbol: chain.toUpperCase(), name: chain, decimals: 18 };
  const nativeBal = parseFloat(nativeRaw.balance || '0') / 10 ** nativeInfo.decimals;
  if (nativeBal > 0.000001) {
    results.push({
      symbol:   nativeInfo.symbol,
      name:     nativeInfo.name,
      balance:  nativeBal,
      usd_price: nativeRaw.usd_price || null,
      usd_value: nativeBal * (nativeRaw.usd_price || 0),
      logo:     null,
      native:   true,
      chain,
    });
  }

  // Tokens ERC-20
  for (const t of (tokensRaw || [])) {
    const bal = parseFloat(t.balance || '0') / 10 ** (t.decimals || 18);
    if (bal < 0.000001) continue;
    const usdVal = t.usd_value != null ? parseFloat(t.usd_value) : bal * (parseFloat(t.usd_price) || 0);
    results.push({
      symbol:    t.symbol || '?',
      name:      t.name   || t.symbol || '?',
      balance:   bal,
      usd_price: t.usd_price != null ? parseFloat(t.usd_price) : null,
      usd_value: usdVal,
      logo:      t.logo   || t.thumbnail || null,
      native:    false,
      chain,
    });
  }

  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!MORALIS_KEY)         return res.status(500).json({ error: 'API key no configurada' });

  const { address, chains = 'eth,polygon' } = req.query;

  if (!address || !/^0x[a-fA-F0-9]{40}$/i.test(address)) {
    return res.status(400).json({ error: 'Dirección inválida' });
  }

  const chainList = chains.split(',').map(c => c.trim()).filter(c => NATIVE[c] || c.length > 0).slice(0, 5);

  try {
    // Consultar todas las chains en paralelo
    const results = await Promise.allSettled(chainList.map(c => getChainBalances(address, c)));

    const tokens = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value)
      .filter(t => t.usd_value > 0.01)          // ignorar dust < $0.01
      .sort((a, b) => b.usd_value - a.usd_value); // mayor valor primero

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ tokens, chains: chainList });
  } catch (e) {
    return res.status(502).json({ error: 'Error al consultar Moralis' });
  }
}
