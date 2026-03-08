#!/usr/bin/env node
/**
 * Street Art Agent — headless runner
 * Accepts inputs via (in priority order):
 *   1. CLI args:         node agent.mjs "Berlin" "sneaker campaign"
 *   2. JSON on stdin:   echo '{"city":"Berlin","brief":"sneakers"}' | node agent.mjs
 *   3. Environment vars (multiple naming conventions):
 *      CITY / INPUT_CITY / NANO_CITY / AGENT_CITY
 *      BRIEF / INPUT_BRIEF / NANO_BRIEF / AGENT_BRIEF
 *   4. ANTHROPIC_API_KEY for auth
 */

import { createRequire } from "module";
import { readFileSync, writeFileSync, appendFileSync } from "fs";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Resolve city from all possible sources
function resolveInput(argIndex, envNames) {
  // 1. CLI args
  if (process.argv[argIndex]) return process.argv[argIndex];
  // 2. Environment variables (try each name)
  for (const name of envNames) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

async function resolveFromStdin() {
  // Only read stdin if it's piped (not a TTY)
  if (process.stdin.isTTY) return {};
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    process.stdin.on("error", () => resolve({}));
    // Timeout after 2s so we don't hang
    setTimeout(() => resolve({}), 2000);
  });
}

async function main() {
  // Read stdin JSON first (if piped)
  const stdinData = await resolveFromStdin();

  const city =
    resolveInput(2, ["CITY", "INPUT_CITY", "NANO_CITY", "AGENT_CITY"]) ||
    stdinData.city ||
    null;

  const brief =
    resolveInput(3, ["BRIEF", "INPUT_BRIEF", "NANO_BRIEF", "AGENT_BRIEF"]) ||
    stdinData.brief ||
    "";

  if (!ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }
  if (!city) {
    console.error(
      "Error: city is required. Pass as CLI arg, stdin JSON, or env var CITY / INPUT_CITY."
    );
    process.exit(1);
  }

  const systemPrompt = buildSystemPrompt(brief);
  const briefContext = brief ? ` The campaign brief is: "${brief}".` : "";
  const userMessage = `Research the street art scene in ${city} using streetartcities.com and other sources. Analyze the visual style and generate 3 advertising campaign concepts inspired by this city's street art aesthetic.${briefContext} Return ONLY the JSON object.`;

  console.log(
    `Running Street Art Agent for: ${city}${brief ? ` | Brief: ${brief}` : ""}`
  );

  let messages = [{ role: "user", content: userMessage }];
  let data = await callClaude(messages, systemPrompt);

  // Agentic loop — handle web_search tool calls
  while (data.stop_reason === "tool_use") {
    console.log("Agent is searching the web...");
    const toolUseBlocks = data.content.filter((b) => b.type === "tool_use");
    const toolResults = toolUseBlocks.map((block) => ({
      type: "tool_result",
      tool_use_id: block.id,
      content: "Search completed. Continue with your analysis.",
    }));

    messages = [
      { role: "user", content: userMessage },
      { role: "assistant", content: data.content },
      { role: "user", content: toolResults },
    ];
    data = await callClaude(messages, systemPrompt);
  }

  const textBlocks = data.content?.filter((b) => b.type === "text") || [];
  const fullText = textBlocks.map((b) => b.text).join("");

  let result;
  try {
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    result = JSON.parse(jsonMatch ? jsonMatch[0] : fullText);
  } catch {
    throw new Error("Could not parse agent response as JSON.");
  }

  const output = JSON.stringify(result, null, 2);
  writeFileSync("result.json", output);

  // Set GitHub Actions output variable if available
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `result<<EOF\n${output}\nEOF\n`);
  }

  console.log("\n--- RESULT ---");
  console.log(output);
  console.log("\nDone. Output written to result.json");
}

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
    { "id": 2, "title": "...", "brand": "...", "concept": "...", "imagePrompt": "..." },
    { "id": 3, "title": "...", "brand": "...", "concept": "...", "imagePrompt": "..." }
  ]
}`;
}

async function callClaude(messages, systemPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: systemPrompt,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  return res.json();
}

main().catch((err) => {
  console.error("Agent failed:", err.message);
  process.exit(1);
});
