// Proxy hacia la Data API de Polymarket.
// Corre en Frankfurt (fra1) para evitar bloqueos geográficos.
// Solo permite lecturas públicas — no expone credenciales ni permite trading.

export default async function handler(req, res) {
  // Solo GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user } = req.query;

  // Validar que sea una wallet address Ethereum válida (0x + 40 hex chars)
  if (!user || !/^0x[a-fA-F0-9]{40}$/i.test(user)) {
    return res.status(400).json({ error: 'Dirección de wallet inválida' });
  }

  try {
    const url = `https://data-api.polymarket.com/positions?user=${encodeURIComponent(user)}&limit=500&sizeThreshold=0.01&sortBy=CURRENT&sortDirection=DESC`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Error en Polymarket API' });
    }

    const data = await response.json();

    // Cache 60s en CDN, sirve stale hasta 5min mientras refresca
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo conectar con Polymarket' });
  }
}
