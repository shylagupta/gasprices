import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.EIA_API_KEY;
const WIDGET_URI = 'ui://at-the-pump/gas-map.html';
const widgetHtml = readFileSync(join(ROOT, 'public', 'widget.html'), 'utf8');

const CITIES = [
  { id: 'sf', name: 'San Francisco', lat: 37.7749, lng: -122.4194 },
  { id: 'la', name: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
  { id: 'sea', name: 'Seattle', lat: 47.6062, lng: -122.3321 },
  { id: 'den', name: 'Denver', lat: 39.7392, lng: -104.9903 },
  { id: 'chi', name: 'Chicago', lat: 41.8781, lng: -87.6298 },
  { id: 'cle', name: 'Cleveland', lat: 41.4993, lng: -81.6944 },
  { id: 'hou', name: 'Houston', lat: 29.7604, lng: -95.3698 },
  { id: 'mia', name: 'Miami', lat: 25.7617, lng: -80.1918 },
  { id: 'nyc', name: 'New York City', lat: 40.7128, lng: -74.006 },
  { id: 'bos', name: 'Boston', lat: 42.3601, lng: -71.0589 }
];
const TARGETS = ['U.S.', 'California', ...CITIES.map(c => c.name)];
const cache = { data: null, expires: 0 };

function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function getPrices() {
  if (cache.data && Date.now() < cache.expires) return cache.data;
  if (!API_KEY) throw new Error('EIA_API_KEY is missing in the server environment.');
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 35);
  const params = new URLSearchParams({
    api_key: API_KEY,
    frequency: 'weekly',
    'data[0]': 'value',
    start: start.toISOString().slice(0, 10),
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    length: '5000'
  });
  const upstream = await fetch(`https://api.eia.gov/v2/petroleum/pri/gnd/data/?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!upstream.ok) throw new Error(`EIA API returned HTTP ${upstream.status}`);
  const json = await upstream.json();
  if (!Array.isArray(json?.response?.data)) throw new Error(json?.error || 'Unexpected EIA API response');
  const rows = json.response.data.filter(r => {
    const product = String(r.product || '').toUpperCase();
    const series = String(r.series || '').toUpperCase();
    return (product === 'EPMR' || series.startsWith('EMM_EPMR_PTE_')) &&
      TARGETS.includes(r['area-name']) && Number.isFinite(Number(r.value));
  });
  // Only compare values from the same published EIA reporting week.
  const byPeriod = new Map();
  for (const r of rows) {
    if (!byPeriod.has(r.period)) byPeriod.set(r.period, new Map());
    const areaMap = byPeriod.get(r.period);
    if (!areaMap.has(r['area-name'])) areaMap.set(r['area-name'], Number(r.value));
  }
  const matchingWeek = [...byPeriod.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .find(([, areas]) => TARGETS.every(area => areas.has(area)));
  if (!matchingWeek) throw new Error('No complete matching weekly EIA dataset found for all 10 cities, California, and the U.S.');
  const [week, values] = matchingWeek;
  const us = values.get('U.S.');
  const california = values.get('California');
  const result = {
    week, us, california, premium: california - us,
    percent: (california / us - 1) * 100,
    cities: CITIES.map(c => ({ ...c, price: values.get(c.name), difference: values.get(c.name) - us })),
    source: 'U.S. Energy Information Administration — Weekly Retail Gasoline and Diesel Prices',
    sourceUrl: 'https://www.eia.gov/petroleum/gasdiesel/'
  };
  cache.data = result;
  cache.expires = Date.now() + 60 * 60 * 1000;
  return result;
}


function makeApp() {
  const server = new McpServer({ name: 'at-the-pump', version: '1.0.0' });
  registerAppResource(server, 'at-the-pump-map', WIDGET_URI, {}, async () => ({
    contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml,
      _meta: { ui: {
        prefersBorder: true,
        csp: {
          resourceDomains: ['https://unpkg.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://tile.openstreetmap.org'],
          connectDomains: ['https://tile.openstreetmap.org']
        }
      }}
    }]
  }));
  registerAppTool(server, 'show_gas_prices', {
    title: 'Show weekly U.S. gasoline price map',
    description: 'Fetch the latest shared reporting week of EIA regular gasoline prices for the U.S., California and ten U.S. cities. Use this to display the interactive map or answer city-price and California-premium questions. Figures are weekly metro averages, not station prices.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { ui: { resourceUri: WIDGET_URI } },
  }, async () => {
    try {
      const data = await getPrices();
      const cheapest = [...data.cities].sort((a,b) => a.price - b.price)[0];
      const mostExpensive = [...data.cities].sort((a,b) => b.price - a.price)[0];
      return {
        content: [{ type: 'text', text: `EIA weekly regular gasoline, week of ${data.week}: U.S. $${data.us.toFixed(3)}/gal, California $${data.california.toFixed(3)}/gal, California premium ${data.premium>=0?'+':''}$${data.premium.toFixed(3)}/gal (${data.percent.toFixed(1)}%). Cheapest included city: ${cheapest.name} ($${cheapest.price.toFixed(3)}). Most expensive: ${mostExpensive.name} ($${mostExpensive.price.toFixed(3)}). The complete city data is in structuredContent.` }],
        structuredContent: data,
      };
    } catch (err) {
      console.error('EIA fetch failed:', err.message);
      return { isError: true, content: [{ type: 'text', text: `Unable to retrieve weekly EIA data: ${err.message}` }] };
    }
  });
  return server;
}

createServer(async (req, res) => {
  const path = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  if (path === '/' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('At the Pump — ChatGPT MCP app. Endpoint: /mcp'); return;
  }
  if (path !== '/mcp') { res.writeHead(404).end('Not found'); return; }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin':'*', 'access-control-allow-methods':'POST, GET, DELETE, OPTIONS', 'access-control-allow-headers':'content-type, mcp-session-id, mcp-protocol-version, authorization', 'access-control-expose-headers':'Mcp-Session-Id' }).end(); return;
  }
  if (!['GET','POST','DELETE'].includes(req.method)) { res.writeHead(405).end(); return; }
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-expose-headers','Mcp-Session-Id');
  const server = makeApp();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req,res); }
  catch (error) { console.error('MCP request:',error); if (!res.headersSent) res.writeHead(500).end('Internal error'); }
}).listen(PORT, () => console.log(`At the Pump MCP server: http://localhost:${PORT}/mcp`));
