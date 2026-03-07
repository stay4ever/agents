# Street Art Agent

> Turn a city's walls into advertising campaigns — powered by Claude AI and street art research.

The Street Art Agent researches a city's graffiti and street art scene, extracts its visual DNA (colors, techniques, cultural themes), and generates 3 tailored advertising campaign concepts — each accompanied by an AI-generated image that captures the city's raw street aesthetic.

---

## What It Does

1. **You provide** a campaign brief and a city
2. **The agent searches** streetartcities.com and the web for that city's street art scene
3. **Claude analyzes** the visual style — dominant colors, techniques, mood, cultural themes
4. **3 campaign concepts** are generated, tailored to your brief and rooted in the city's aesthetic
5. **AI images are generated** for each campaign — abstract street art visuals, not product shots

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | 18 or higher |
| npm | 8 or higher |
| Anthropic API key | Required |

**No other accounts needed.** Image generation uses [Stable Horde](https://stablehorde.net) — a free, decentralized AI image network.

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/agents.git
cd agents/street_art_agent
```

### 2. Run setup

```bash
bash setup.sh
```

The setup script will:
- Check your Node.js version
- Create your `.env` file
- Prompt you to add your Anthropic API key
- Install all dependencies

### 3. Start the agent

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Manual Setup

If you prefer to set up manually:

```bash
# Install dependencies
npm install

# Create your environment file
cp .env.example .env

# Open .env and add your Anthropic API key
# VITE_ANTHROPIC_API_KEY=sk-ant-...

# Start
npm run dev
```

---

## Getting Your Anthropic API Key

1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Click **Create Key**
3. Copy the key and paste it into your `.env` file as `VITE_ANTHROPIC_API_KEY`

> The key is only used locally and is never sent anywhere except the Anthropic API.

---

## How to Use

1. **Enter your campaign brief** — describe the type of campaign you're running
   *(e.g. "sustainable sneaker launch", "energy drink for Gen Z", "luxury watch rebrand")*

2. **Enter a city** — or click one of the quick-pick city buttons

3. **Click Generate** — the agent will:
   - Research the city's street art scene (takes 10–30 seconds)
   - Return a style analysis with dominant colors, techniques, and themes
   - Generate 3 campaign concepts tailored to your brief
   - Produce AI-generated street art imagery for each campaign (takes 30–90 seconds per image)

---

## Configuration

All configuration lives in `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |

---

## Cost

| Component | Cost |
|-----------|------|
| Claude Sonnet + web search | ~$0.10–0.15 per run |
| Image generation (Stable Horde) | Free |
| **Estimated per run** | **~$0.10–0.15** |

---

## Project Structure

```
street_art_agent/
├── src/
│   └── StreetArtAgent.jsx   # Main agent — all logic lives here
├── manifest.json             # Agent metadata
├── vite.config.js            # Dev server + API proxy config
├── .env.example              # Environment variable template
├── setup.sh                  # One-command setup script
└── package.json
```

---

## Troubleshooting

**Images not loading**
Images are generated via Stable Horde's free network. Queue times vary (30–90 seconds). If an image fails, the agent will retry up to 2 times automatically.

**API error 401**
Your Anthropic API key is invalid or not set. Check your `.env` file.

**API error 529 / overloaded**
Anthropic is under high load. Wait a moment and try again.

**`node: command not found`**
Install Node.js from [nodejs.org](https://nodejs.org) (v18 or higher required).

---

## Security Note

This agent runs entirely in your browser and calls the Anthropic API directly. The `VITE_` prefix makes the API key visible in browser network traffic. This is suitable for local/personal use. For a production deployment, route the API call through a backend server.

---

## License

MIT — free to use, modify, and distribute.
