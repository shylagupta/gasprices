# At the Pump — ChatGPT app (MCP Apps SDK)

This is a **ChatGPT app**, not a standalone website. It serves an MCP `show_gas_prices` tool and an interactive Leaflet/OpenStreetMap widget that renders within ChatGPT. The API key is server-only.

## Run locally

Requires Node.js 22+ and npm.

```sh
npm install
cp .env.example .env
# Edit .env and set EIA_API_KEY to your key
npm start
```

MCP endpoint: `http://localhost:8787/mcp`. Plain `/` is just a health check.

## Connect inside ChatGPT

1. Deploy the Node server over HTTPS or use a local tunnel such as `ngrok http 8787` while testing.
2. In ChatGPT Plugins, select **Add custom MCP server** (availability and wording depend on your account/workspace).
3. Enter the public HTTPS URL ending in `/mcp`, create the plugin, and install it.
4. In a new chat, select `@At the Pump` and ask **“Show this week's gas price map.”**

See [OpenAI's official MCP app quickstart](https://developers.openai.com/plugins/build/app-quickstart).

## Features

- `show_gas_prices` tool: live weekly EIA regular gasoline prices, California premium, U.S. average, all 10 cities; useful to ChatGPT as text and structured data.
- Interactive map: prices rendered as red/green markers relative to the U.S. average; city ranking and selected-city zoom.
- App resource: self-contained HTML/CSS/JS widget with Leaflet CDN + OSM tiles, permissioned in MCP resource CSP.
- The server fetches and caches EIA data, never exposes its EIA key to ChatGPT tool outputs or the widget.
- Unavailable upstream data yields an error, not invented prices.

**EIA coverage:** Prices represent surveyed metropolitan areas, not specific gas stations. Values correspond to the most recent shared reporting week, which can precede the current calendar week.

**Security:** Set the key in server environment variables. Do not commit `.env`. For a public deployment, add appropriate authentication, quotas/rate limiting, and deployment controls before inviting other users. This starter is for personal development/testing.

**Not yet deployed:** Installing the app inside ChatGPT requires a reachable HTTPS server and a custom plugin connection, which are not created merely by downloading this project.
