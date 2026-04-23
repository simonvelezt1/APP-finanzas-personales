// Proxy servidor para obtener la TRM (USD→COP) desde 3 fuentes.
// Corre en Frankfurt (fra1). Cache CDN 1h, stale-while-revalidate 24h.
// No requiere API key.

export const config = { regions: ['fra1'] };

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

export default async function handler(req, res) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    return res.status(204).end();
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sources = [
    // 1. Banco de la República — TRM oficial de Colombia
    async () => {
      const r = await fetch(
        'https://www.datos.gov.co/resource/mcec-87by.json?$order=vigenciadesde%20DESC&$limit=1',
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) }
      );
      if (!r.ok) throw new Error(`datos.gov.co ${r.status}`);
      const d = await r.json();
      const v = parseFloat(d[0]?.valor);
      if (!v || v < 100) throw new Error('Valor inválido');
      const date = (d[0]?.vigenciadesde || '').split('T')[0] || new Date().toISOString().split('T')[0];
      return { trm: v, date, source: 'Banco de la República' };
    },
    // 2. open.er-api.com
    async () => {
      const r = await fetch('https://open.er-api.com/v6/latest/USD', {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`open.er-api ${r.status}`);
      const d = await r.json();
      const v = d.conversion_rates?.COP || d.rates?.COP;
      if (!v || v < 100) throw new Error('Valor inválido');
      return { trm: v, date: new Date().toISOString().split('T')[0], source: 'open.er-api.com' };
    },
    // 3. exchangerate-api.com
    async () => {
      const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`exchangerate-api ${r.status}`);
      const d = await r.json();
      const v = d.rates?.COP;
      if (!v || v < 100) throw new Error('Valor inválido');
      return { trm: v, date: d.date || new Date().toISOString().split('T')[0], source: 'exchangerate-api.com' };
    },
    // 4. fawazahmed0 currency-api (jsDelivr CDN, no key, supports COP)
    async () => {
      const r = await fetch('https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/usd/cop.json', {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`currency-api ${r.status}`);
      const d = await r.json();
      const v = d.cop;
      if (!v || v < 100) throw new Error('Valor inválido');
      return { trm: v, date: d.date || new Date().toISOString().split('T')[0], source: 'currency-api' };
    },
  ];

  const errors = [];
  for (const src of sources) {
    try {
      const result = await src();
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      return res.status(200).json(result);
    } catch (e) {
      errors.push(e.message);
    }
  }

  return res.status(502).json({ error: 'Todas las fuentes fallaron', details: errors });
}
