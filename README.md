# Cloghan Tank Monitor V2

Standalone Windows-only local web app for capturing tank-monitor screenshots, extracting tank data with an OpenAI-compatible vision API, storing readings in SQLite, and displaying/editing readings in a browser dashboard.

See `docs/product-spec.md` for the full specification.

## Development

1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and fill in AI settings.
3. Install dependencies:

```bash
npm install
```

4. Start development servers:

```bash
npm run dev
```

5. Open the web app:

```txt
http://localhost:5173
```

The backend listens on `http://localhost:3000` by default.
