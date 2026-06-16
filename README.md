# Cloghan Tank Monitor V2

Standalone Windows-only local web app for capturing tank-monitor screenshots, extracting tank data with an OpenAI-compatible vision API, storing readings in SQLite, and displaying/editing readings in a browser dashboard.

See `docs/product-spec.md` for the full specification.

## Quick Install

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/harrisonk0/cloghan-tank-monitor-v2/main/install.ps1 | iex
```

This downloads and runs the installer, which:
1. Installs Node.js, Git, and ngrok (via winget)
2. Prompts for your AI API key
3. Installs dependencies
4. Creates desktop and startup shortcuts

The installer detects existing installs and preserves your settings.

## Manual Install

1. Install Node.js 20+.
2. Clone this repo.
3. Copy `.env.example` to `.env` and fill in AI settings.
4. Install dependencies:

```bash
npm install
```

5. Start the app:

```bash
npm run tray
```

The web dashboard will be at `http://localhost:5173`. The backend listens on `http://localhost:3000` by default.

## Development

```bash
npm run dev
```

Starts both the backend and frontend dev servers with hot reload.
