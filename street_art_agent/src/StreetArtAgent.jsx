import { useState, useEffect, useCallback } from "react";

// --- Stable Horde image generation (free, no API key) ---
// Routed through Vite proxy to avoid CORS issues
const HORDE_KEY = "0000000000"; // anonymous key

async function generateImage(prompt, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch("/horde-api/generate/async", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: HORDE_KEY },
        body: JSON.stringify({
          prompt: prompt.slice(0, 500),
          params: { width: 512, height: 512, steps: 20, cfg_scale: 7 },
          nsfw: false,
          models: ["Deliberate"],
        }),
      });
      if (!res.ok) {
        if (attempt < retries) { await new Promise((r) => setTimeout(r, 5000)); continue; }
        throw new Error("Horde submit failed");
      }
      const { id } = await res.json();

      // Poll until done (typically 30-90s)
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const check = await fetch(`/horde-api/generate/status/${id}`);
        const status = await check.json();
        if (status.done && status.generations?.length > 0) {
          const imgUrl = status.generations[0].img;
          const imgRes = await fetch(`/horde-img-proxy/${encodeURIComponent(imgUrl)}`);
          if (!imgRes.ok) throw new Error("Failed to download image");
          const blob = await imgRes.blob();
          return URL.createObjectURL(blob);
        }
        if (status.faulted) throw new Error("Image generation faulted");
      }
      throw new Error("Image generation timed out");
    } catch (e) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      throw e;
    }
  }
}

// --- Claude agent ---
function buildSystemPrompt(campaignBrief) {
  const briefLine = campaignBrief
    ? `\nThe user is running the following type of campaign: "${campaignBrief}". Tailor all 3 campaign concepts to fit this brief.\n`
    : "";

  return `You are a creative street art analyst and advertising campaign director.

When given a city, you will:
1. Use web_search to find street art and graffiti from that city on streetartcities.com and related sources
2. Analyze the visual style: dominant colors, themes, techniques, cultural references, mood
3. Generate 3 unique advertising campaign concepts INSPIRED by the city's street art aesthetic
${briefLine}
IMPORTANT: You MUST respond with ONLY a valid JSON object — no markdown, no explanation, no backticks, just raw JSON.

CRITICAL imagePrompt rules:
- The image must be ABSTRACT and capture the GRAFFITI CULTURE and STREET ART AESTHETIC of the city
- DO NOT include the campaign product, brand, or any commercial elements in the image prompt
- Focus on: spray paint textures, urban walls, murals, stencil art, dripping paint, bold colors, concrete, street culture
- Reference the city's specific street art style, colors, and cultural motifs
- The image should feel like a piece of street art you would find on a wall in that city
- No text, no logos, no product shots — pure abstract street art vibes

JSON format:
{
  "city": "City Name",
  "styleAnalysis": {
    "dominantColors": ["#hex1", "#hex2", "#hex3"],
    "mood": "short mood description",
    "techniques": "painting/stencil/mosaic/etc",
    "themes": "brief cultural themes found",
    "summary": "2-3 sentence style description"
  },
  "campaigns": [
    {
      "id": 1,
      "title": "Campaign Name",
      "brand": "Hypothetical brand type (e.g. sneakers, coffee, tech)",
      "concept": "2-sentence campaign concept explaining how this campaign connects the street art aesthetic to the brand",
      "imagePrompt": "Abstract street art image prompt capturing the graffiti culture of the city. Focus on spray paint, urban textures, bold colors, and cultural motifs. No products, no text, no logos. Max 2 sentences."
    },
    {
      "id": 2,
      "title": "...",
      "brand": "...",
      "concept": "...",
      "imagePrompt": "..."
    },
    {
      "id": 3,
      "title": "...",
      "brand": "...",
      "concept": "...",
      "imagePrompt": "..."
    }
  ]
}`;
}

async function runStreetArtAgent(city, campaignBrief, onStatus) {
  onStatus("Searching for street art in " + city + "...");

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_ANTHROPIC_API_KEY in .env file");
  }

  const systemPrompt = buildSystemPrompt(campaignBrief);
  const briefContext = campaignBrief
    ? ` The campaign brief is: "${campaignBrief}".`
    : "";
  const userMessage = `Research the street art scene in ${city} using streetartcities.com and other sources. Analyze the visual style and generate 3 advertising campaign concepts inspired by this city's street art aesthetic.${briefContext} Return ONLY the JSON object.`;

  const makeRequest = (messages) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: systemPrompt,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages,
      }),
    });

  const response = await makeRequest([
    { role: "user", content: userMessage },
  ]);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  let data = await response.json();

  // Handle agentic loop: keep calling if the model wants to use tools
  while (data.stop_reason === "tool_use") {
    onStatus("Agent is researching...");

    const toolUseBlocks = data.content.filter((b) => b.type === "tool_use");
    const toolResults = toolUseBlocks.map((block) => ({
      type: "tool_result",
      tool_use_id: block.id,
      content: "Search completed. Continue with your analysis.",
    }));

    const continueResponse = await makeRequest([
      { role: "user", content: userMessage },
      { role: "assistant", content: data.content },
      { role: "user", content: toolResults },
    ]);

    if (!continueResponse.ok) {
      const err = await continueResponse.text();
      throw new Error(`API error ${continueResponse.status}: ${err}`);
    }

    data = await continueResponse.json();
  }

  onStatus("Analyzing art style and building campaigns...");

  const textBlocks = data.content?.filter((b) => b.type === "text") || [];
  const fullText = textBlocks.map((b) => b.text).join("");

  let parsed;
  try {
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : fullText);
  } catch (e) {
    throw new Error("Could not parse agent response. Try another city.");
  }

  return parsed;
}

// --- Components ---
function SprayDrip({ color, style }) {
  return (
    <svg
      viewBox="0 0 40 120"
      style={{ ...style, opacity: 0.7 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={`M20 0 Q22 30 20 50 Q18 80 22 120`}
        stroke={color}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="22" cy="120" r="4" fill={color} />
    </svg>
  );
}

function CampaignCard({ campaign, colors, index, isVisible }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [imgStatus, setImgStatus] = useState("loading"); // loading | done | error
  const accent = colors[index % colors.length] || "#FF4D00";
  const color2 = colors[(index + 1) % colors.length] || "#00E5FF";

  useEffect(() => {
    let cancelled = false;
    setImgSrc(null);
    setImgStatus("loading");

    generateImage(campaign.imagePrompt)
      .then((src) => {
        if (!cancelled) {
          setImgSrc(src);
          setImgStatus("done");
        }
      })
      .catch(() => {
        if (!cancelled) setImgStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [campaign.imagePrompt]);

  return (
    <div
      style={{
        background: "rgba(10,10,10,0.85)",
        border: `1px solid ${accent}40`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: "2px",
        overflow: "hidden",
        transform: isVisible ? "translateY(0)" : "translateY(40px)",
        opacity: isVisible ? 1 : 0,
        transition: `all 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.15}s`,
        position: "relative",
      }}
    >
      {/* Image */}
      <div
        style={{
          position: "relative",
          paddingTop: "56.25%",
          background: "#111",
          overflow: "hidden",
        }}
      >
        {/* Gradient background */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(135deg, ${accent}30 0%, ${color2}20 50%, #11111180 100%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {imgStatus === "loading" && (
            <>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  border: `3px solid ${accent}40`,
                  borderTopColor: accent,
                  animation: "spin 1s linear infinite",
                }}
              />
              <span
                style={{
                  fontSize: "11px",
                  letterSpacing: "2px",
                  textTransform: "uppercase",
                  color: "#555",
                }}
              >
                AI generating image...
              </span>
            </>
          )}
          {imgStatus === "error" && (
            <div
              style={{
                padding: "16px 24px",
                color: "#555",
                fontSize: "12px",
                fontFamily: "'Courier New', monospace",
                lineHeight: "1.6",
                textAlign: "center",
                maxWidth: "80%",
              }}
            >
              <div
                style={{
                  fontSize: "9px",
                  letterSpacing: "3px",
                  color: accent,
                  marginBottom: "8px",
                  textTransform: "uppercase",
                }}
              >
                Prompt
              </div>
              {campaign.imagePrompt}
            </div>
          )}
        </div>
        {/* Generated image */}
        {imgSrc && (
          <img
            src={imgSrc}
            alt={campaign.title}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              animation: "fadeIn 0.5s ease",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            background: accent,
            color: "#000",
            fontFamily: "'Anton', sans-serif",
            fontSize: "11px",
            padding: "3px 10px",
            letterSpacing: "2px",
            textTransform: "uppercase",
          }}
        >
          {campaign.brand}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "20px 24px 24px" }}>
        <div
          style={{
            fontFamily: "'Anton', sans-serif",
            fontSize: "22px",
            color: "#fff",
            letterSpacing: "1px",
            marginBottom: "8px",
            textTransform: "uppercase",
          }}
        >
          {campaign.title}
        </div>
        <p
          style={{
            color: "#aaa",
            fontSize: "14px",
            lineHeight: "1.7",
            margin: 0,
            fontFamily: "'Courier New', monospace",
          }}
        >
          {campaign.concept}
        </p>
        <div
          style={{
            marginTop: "16px",
            padding: "12px",
            background: "#111",
            borderRadius: "1px",
          }}
        >
          <div
            style={{
              fontSize: "9px",
              color: accent,
              letterSpacing: "3px",
              marginBottom: "6px",
              textTransform: "uppercase",
            }}
          >
            Image Prompt
          </div>
          <div
            style={{
              fontSize: "11px",
              color: "#666",
              fontFamily: "'Courier New', monospace",
              lineHeight: "1.5",
            }}
          >
            {campaign.imagePrompt}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StreetArtAgent() {
  const [city, setCity] = useState("");
  const [campaignBrief, setCampaignBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [cardsVisible, setCardsVisible] = useState(false);

  useEffect(() => {
    if (result) {
      setTimeout(() => setCardsVisible(true), 100);
    }
  }, [result]);

  const handleSubmit = useCallback(
    async (cityOverride) => {
      const target = (
        typeof cityOverride === "string" ? cityOverride : city
      ).trim();
      if (!target || loading) return;
      setCity(target);
      setLoading(true);
      setError("");
      setResult(null);
      setCardsVisible(false);

      try {
        const data = await runStreetArtAgent(
          target,
          campaignBrief.trim(),
          setStatus
        );
        setResult(data);
        setStatus("Generating campaign images via AI...");
        // Images load independently in each CampaignCard
        setTimeout(() => setStatus(""), 2000);
      } catch (e) {
        setError(e.message || "Something went wrong. Try again.");
        setStatus("");
      } finally {
        setLoading(false);
      }
    },
    [city, campaignBrief, loading]
  );

  const colors =
    result?.styleAnalysis?.dominantColors || ["#FF4D00", "#00E5FF", "#FFD600"];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#080808",
        fontFamily: "'Courier New', monospace",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes flicker { 0%,100%{opacity:1} 50%{opacity:0.85} }
        @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        input::placeholder { color: #333; }
        input:focus { outline: none; }
        textarea::placeholder { color: #333; }
        textarea:focus { outline: none; }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #333; }
      `}</style>

      {/* Noise texture overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          opacity: 0.03,
          pointerEvents: "none",
          zIndex: 100,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* Grid background */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "linear-gradient(#ffffff05 1px, transparent 1px), linear-gradient(90deg, #ffffff05 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Spray drips */}
      <SprayDrip
        color="#FF4D00"
        style={{
          position: "fixed",
          top: 0,
          left: "10%",
          width: "30px",
          height: "120px",
        }}
      />
      <SprayDrip
        color="#00E5FF"
        style={{
          position: "fixed",
          top: 0,
          right: "15%",
          width: "30px",
          height: "90px",
        }}
      />
      <SprayDrip
        color="#FFD600"
        style={{
          position: "fixed",
          top: 0,
          left: "70%",
          width: "30px",
          height: "140px",
        }}
      />

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "60px 24px 80px" }}>
        {/* Header */}
        <div style={{ marginBottom: "60px" }}>
          <div
            style={{
              fontSize: "11px",
              letterSpacing: "5px",
              color: "#FF4D00",
              textTransform: "uppercase",
              marginBottom: "16px",
              animation: "flicker 3s ease-in-out infinite",
            }}
          >
            STREET ART AI AGENT
          </div>
          <h1
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: "clamp(42px, 8vw, 84px)",
              lineHeight: 0.9,
              margin: 0,
              color: "#fff",
              textTransform: "uppercase",
              letterSpacing: "-1px",
            }}
          >
            CITY WALLS
            <br />
            <span style={{ color: "#FF4D00" }}>BECOME ADS</span>
          </h1>
          <p
            style={{
              marginTop: "20px",
              color: "#555",
              fontSize: "13px",
              letterSpacing: "1px",
              lineHeight: "1.8",
              maxWidth: "500px",
            }}
          >
            Describe your campaign, pick a city. The agent researches its street
            art scene, extracts the visual DNA, and generates ad campaigns that
            speak the city's aesthetic language — with AI-generated imagery.
          </p>
        </div>

        {/* Inputs */}
        <div style={{ marginBottom: "60px" }}>
          {/* Campaign Brief */}
          <div
            style={{
              display: "flex",
              border: "1px solid #222",
              borderRadius: "2px",
              overflow: "hidden",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                padding: "0 20px",
                display: "flex",
                alignItems: "center",
                color: "#00E5FF",
                fontSize: "12px",
                letterSpacing: "2px",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              brief
            </div>
            <input
              value={campaignBrief}
              onChange={(e) => setCampaignBrief(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="e.g. sustainable fashion launch, energy drink for Gen Z, luxury watch rebrand..."
              disabled={loading}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: "#fff",
                fontSize: "14px",
                padding: "14px 0",
                fontFamily: "'Courier New', monospace",
                letterSpacing: "1px",
              }}
            />
          </div>

          {/* City target */}
          <div
            style={{
              display: "flex",
              border: "1px solid #222",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "0 20px",
                display: "flex",
                alignItems: "center",
                color: "#FF4D00",
                fontSize: "18px",
              }}
            >
              target
            </div>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Sao Paulo, Berlin, Melbourne, Tokyo..."
              disabled={loading}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: "#fff",
                fontSize: "16px",
                padding: "18px 0",
                fontFamily: "'Courier New', monospace",
                letterSpacing: "1px",
              }}
            />
            <button
              onClick={() => handleSubmit()}
              disabled={loading || !city.trim()}
              style={{
                background: loading ? "#1a1a1a" : "#FF4D00",
                border: "none",
                color: loading ? "#444" : "#000",
                fontFamily: "'Anton', sans-serif",
                fontSize: "14px",
                letterSpacing: "3px",
                padding: "18px 28px",
                cursor: loading ? "not-allowed" : "pointer",
                textTransform: "uppercase",
                transition: "all 0.2s",
                whiteSpace: "nowrap",
              }}
            >
              {loading ? "SCANNING..." : "GENERATE"}
            </button>
          </div>

          {status && (
            <div
              style={{
                marginTop: "16px",
                color: "#FFD600",
                fontSize: "12px",
                letterSpacing: "2px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#FFD600",
                  animation: "pulse 1s ease-in-out infinite",
                }}
              />
              {status}
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: "16px",
                color: "#FF4D00",
                fontSize: "13px",
                padding: "12px 16px",
                border: "1px solid #FF4D0040",
                background: "#FF4D0010",
                borderRadius: "2px",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {result && (
          <div>
            {/* Style Analysis */}
            <div
              style={{
                marginBottom: "40px",
                padding: "24px",
                border: "1px solid #1a1a1a",
                borderTop: `3px solid ${colors[0] || "#FF4D00"}`,
                background: "rgba(10,10,10,0.6)",
                transform: cardsVisible ? "translateY(0)" : "translateY(20px)",
                opacity: cardsVisible ? 1 : 0,
                transition: "all 0.5s ease",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: "16px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "9px",
                      letterSpacing: "4px",
                      color: "#555",
                      marginBottom: "6px",
                      textTransform: "uppercase",
                    }}
                  >
                    City DNA Analysis
                  </div>
                  <div
                    style={{
                      fontFamily: "'Anton', sans-serif",
                      fontSize: "32px",
                      color: "#fff",
                      textTransform: "uppercase",
                      letterSpacing: "2px",
                    }}
                  >
                    {result.city}
                  </div>
                </div>
                <div
                  style={{ display: "flex", gap: "8px", alignItems: "center" }}
                >
                  {colors.slice(0, 4).map((c, i) => (
                    <div
                      key={i}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "2px",
                        background: c,
                        border: "1px solid #333",
                      }}
                    />
                  ))}
                </div>
              </div>
              <div
                style={{
                  marginTop: "16px",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: "12px",
                }}
              >
                {[
                  { label: "Mood", value: result.styleAnalysis?.mood },
                  {
                    label: "Techniques",
                    value: result.styleAnalysis?.techniques,
                  },
                  { label: "Themes", value: result.styleAnalysis?.themes },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    style={{
                      padding: "12px",
                      background: "#0d0d0d",
                      borderRadius: "1px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "9px",
                        letterSpacing: "3px",
                        color: "#555",
                        marginBottom: "4px",
                        textTransform: "uppercase",
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#bbb",
                        lineHeight: "1.5",
                      }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
              <p
                style={{
                  marginTop: "16px",
                  color: "#666",
                  fontSize: "13px",
                  lineHeight: "1.8",
                  margin: "16px 0 0",
                }}
              >
                {result.styleAnalysis?.summary}
              </p>
            </div>

            {/* Campaign header */}
            <div
              style={{
                marginBottom: "24px",
                display: "flex",
                alignItems: "center",
                gap: "16px",
              }}
            >
              <div
                style={{ height: "1px", flex: 1, background: "#1a1a1a" }}
              />
              <div
                style={{
                  fontSize: "10px",
                  letterSpacing: "4px",
                  color: "#444",
                  textTransform: "uppercase",
                }}
              >
                3 Campaign Concepts
              </div>
              <div
                style={{ height: "1px", flex: 1, background: "#1a1a1a" }}
              />
            </div>

            {/* Campaign Cards */}
            <div style={{ display: "grid", gap: "24px" }}>
              {result.campaigns?.map((campaign, i) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  colors={colors}
                  index={i}
                  isVisible={cardsVisible}
                />
              ))}
            </div>

            <div
              style={{
                marginTop: "40px",
                textAlign: "center",
                fontSize: "10px",
                color: "#333",
                letterSpacing: "2px",
                textTransform: "uppercase",
              }}
            >
              Images generated by Stable Horde | Style sourced from
              streetartcities.com | Powered by Claude
            </div>
          </div>
        )}

        {/* Empty state */}
        {!result && !loading && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div
              style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.15 }}
            >
              +
            </div>
            <div
              style={{
                color: "#2a2a2a",
                fontSize: "11px",
                letterSpacing: "4px",
                textTransform: "uppercase",
              }}
            >
              Describe your campaign, then pick a city
            </div>
            <div
              style={{
                marginTop: "32px",
                display: "flex",
                justifyContent: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              {["Sao Paulo", "Berlin", "Melbourne", "NYC", "Tokyo", "Bogota"].map(
                (c) => (
                  <button
                    key={c}
                    onClick={() => handleSubmit(c)}
                    style={{
                      background: "transparent",
                      border: "1px solid #1f1f1f",
                      color: "#444",
                      padding: "8px 16px",
                      fontSize: "12px",
                      cursor: "pointer",
                      fontFamily: "'Courier New', monospace",
                      letterSpacing: "1px",
                      borderRadius: "2px",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.borderColor = "#FF4D00";
                      e.target.style.color = "#FF4D00";
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.borderColor = "#1f1f1f";
                      e.target.style.color = "#444";
                    }}
                  >
                    {c}
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
