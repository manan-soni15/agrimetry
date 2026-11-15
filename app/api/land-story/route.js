import { NextResponse } from "next/server";
import { validateFarmGeometry } from "@/lib/vegetation/earth-search";

// Keep the complete request comfortably below the 60-second route limit.
export const maxDuration = 60;

const OPTIONAL_SOURCE_TIMEOUT_MS = 8_000;
const GEMINI_TIMEOUT_MS = 40_000;
const DEFAULT_MODEL = "gemini-3.6-flash";
const MAX_PROMPT_EVIDENCE_CHARS = 18_000;

const STORY_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    opening: { type: "STRING" },
    chapters: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          heading: { type: "STRING" },
          story: { type: "STRING" },
          claimType: { type: "STRING", enum: ["observation", "interpretation", "context"] },
          evidenceIds: { type: "ARRAY", items: { type: "STRING" } },
          fieldQuestion: { type: "STRING" },
        },
        required: ["heading", "story", "claimType", "evidenceIds", "fieldQuestion"],
      },
    },
    nextChecks: { type: "ARRAY", items: { type: "STRING" } },
    limitations: { type: "ARRAY", items: { type: "STRING" } },
    closing: { type: "STRING" },
  },
  required: ["title", "opening", "chapters", "nextChecks", "limitations", "closing"],
};

const EVIDENCE_SOURCES = {
  sentinel2_vegetation: "Sentinel-2",
  soil_profile: "ISRIC SoilGrids / farmer soil tests / NASA soil moisture",
  water_stress: "NASA POWER / water-stress analysis",
  climate_history: "NASA POWER climate history",
};

function collectCoords(geometry, out = []) {
  if (!geometry) return out;
  const walk = (value) => Array.isArray(value) && typeof value[0] === "number"
    ? out.push(value)
    : Array.isArray(value) && value.forEach(walk);
  walk(geometry.coordinates);
  return out;
}

function centerOf(geometry) {
  const coords = collectCoords(geometry);
  if (!coords.length) return null;
  return {
    latitude: coords.reduce((sum, point) => sum + point[1], 0) / coords.length,
    longitude: coords.reduce((sum, point) => sum + point[0], 0) / coords.length,
  };
}

function validateVegetation(result) {
  const monthly = Array.isArray(result?.monthly) ? result.monthly : [];
  const hasMonthlyValues = monthly.some((month) => Number.isFinite(month?.meanNdvi));
  return hasMonthlyValues && result?.summary && Number.isFinite(
    result.summary.meanNdvi ?? result.summary.latestMonthMeanNdvi,
  );
}

function trimVegetation(result) {
  return {
    source: "Sentinel-2 Level-2A via Element84 Earth Search",
    summary: result.summary,
    monthly: (result.monthly || []).slice(-18).map((month) => ({
      month: month.month,
      meanNdvi: month.meanNdvi,
      observedAt: month.observedAt,
      validPixelFraction: month.validPixelFraction,
    })),
    phenology: result.phenology || null,
    lowVegetation: result.lowVegetation || null,
    fieldVariability: result.fieldVariability || null,
  };
}

// Climate history includes a long daily series. Do not send those thousands of
// points to Gemini: the monthly history is enough for a concise narrative.
function compactClimate(data) {
  const parameter = data?.parameter || {};
  const monthlyKeys = Object.keys(parameter.T2M || {}).sort().slice(-24);
  const monthly = {};
  for (const key of ["T2M", "PRECTOTCORR", "GWETROOT"]) {
    const values = parameter[key] || {};
    monthly[key] = Object.fromEntries(monthlyKeys
      .filter((month) => Object.prototype.hasOwnProperty.call(values, month))
      .map((month) => [month, values[month]]));
  }
  return {
    source: data?.source || "NASA POWER",
    startYear: data?.startYear,
    endYear: data?.endYear,
    monthly,
    note: data?.note,
  };
}

function compactValue(value, depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 900);
  if (depth >= 4) return "[details omitted]";
  if (Array.isArray(value)) return value.slice(-12).map((item) => compactValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["daily", "raw", "image", "mapImage"].includes(key))
      .slice(0, 18)
      .map(([key, item]) => [key, compactValue(item, depth + 1)]));
  }
  return String(value).slice(0, 200);
}

function compactEvidenceData(id, data) {
  if (id === "climate_history") return compactClimate(data);
  return compactValue(data);
}

async function optionalJson(url, options = {}) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(OPTIONAL_SOURCE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return { available: false, error: `HTTP ${response.status}` };
    const data = await response.json();
    return { available: true, data, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    const message = error?.name === "TimeoutError"
      ? `Timed out after ${Math.round(OPTIONAL_SOURCE_TIMEOUT_MS / 1000)} seconds`
      : String(error?.message || "Unavailable").slice(0, 150);
    return { available: false, error: message, elapsedMs: Date.now() - startedAt };
  }
}

function validateStory(story, evidenceIds) {
  if (!story || !Array.isArray(story.chapters) || story.chapters.length < 3) {
    throw new Error("Gemini returned an incomplete land story. Please try again.");
  }
  const allowed = new Set(evidenceIds);
  story.chapters = story.chapters.map((chapter) => ({
    ...chapter,
    evidenceIds: (chapter.evidenceIds || []).filter((id) => allowed.has(id)),
  }));
  story.nextChecks = (story.nextChecks || []).slice(0, 6);
  story.limitations = (story.limitations || []).slice(0, 6);
  return story;
}

function sanitizeClientEvidence(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && Object.prototype.hasOwnProperty.call(EVIDENCE_SOURCES, item.id))
    .map((item) => ({
      id: item.id,
      source: EVIDENCE_SOURCES[item.id],
      status: item.status === "available" ? "available" : "unavailable",
      data: item.status === "available" ? compactEvidenceData(item.id, item.data) : null,
      note: typeof item.note === "string" ? item.note.slice(0, 250) : null,
    }));
}

function serializePromptEvidence(items) {
  const compact = [];
  for (const item of items) {
    const candidate = [...compact, item];
    if (JSON.stringify(candidate).length <= MAX_PROMPT_EVIDENCE_CHARS) {
      compact.push(item);
      continue;
    }
    // Keep the source/status visible, but omit a large optional payload rather
    // than cutting JSON in the middle and sending malformed evidence to Gemini.
    compact.push({
      id: item.id,
      source: item.source,
      status: item.status,
      data: null,
      note: item.note || "Source details omitted to keep the evidence prompt within size limits.",
    });
  }
  return JSON.stringify(compact);
}

function getGeminiError(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return "We took too long to finish this story. Your completed field analysis is still saved. Please try again.";
  }
  return String(error?.message || "Could not generate the land story. Please try again.").slice(0, 400);
}

async function callGemini({ apiKey, model, contents, generationConfig, systemInstruction }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      body: JSON.stringify({
        ...(systemInstruction ? { systemInstruction } : {}),
        contents,
        generationConfig: {
          ...generationConfig,
          ...(model.startsWith("gemini-3.") ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
        },
      }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini request failed (HTTP ${response.status}).`;
    const error = new Error(message.slice(0, 450));
    error.status = response.status;
    throw error;
  }
  const generatedText = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!generatedText) throw new Error("We returned an empty response. Please try again.");
  return generatedText;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: " is not configured. Add GEMINI_API_KEY to .env.local and restart the server." }, { status: 503 });
  }

  let geometry;
  try {
    geometry = validateFarmGeometry(body?.field?.geometry);
  } catch (error) {
    return NextResponse.json({ error: error.message || "A valid saved field boundary is required." }, { status: 400 });
  }

  if (!validateVegetation(body?.vegetationAnalysis)) {
    return NextResponse.json({
      error: "Complete Field Vegetation analysis first. The storyteller only generates a story from a completed Sentinel-2 analysis.",
    }, { status: 409 });
  }

  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const isFollowUp = typeof body?.question === "string" && body.question.trim();
  let evidence;

  if (isFollowUp) {
    // Reuse the evidence already gathered for the story. Do not make all three
    // optional API calls again for every follow-up question.
    evidence = sanitizeClientEvidence(body.evidence);
    if (!evidence.some((item) => item.id === "sentinel2_vegetation")) {
      evidence.unshift({
        id: "sentinel2_vegetation",
        source: EVIDENCE_SOURCES.sentinel2_vegetation,
        status: "available",
        data: trimVegetation(body.vegetationAnalysis),
        note: null,
      });
    }

    const question = body.question.trim().slice(0, 500);
    const storyContext = JSON.stringify(body?.story || {}).slice(0, 7_000);
    const evidenceContext = serializePromptEvidence(evidence);
    const answerPrompt = `Answer the farmer's follow-up question using only the verified evidence and existing story. Be interactive, clear and practical. Separate what is observed from what is only a possible explanation. Do not invent measurements or give precise treatment prescriptions. If evidence is insufficient, say what additional observation would help. Existing story: ${storyContext}. Evidence: ${evidenceContext}. Farmer question: ${question}`;

    try {
      const answer = await callGemini({
        apiKey,
        model,
        contents: [{ role: "user", parts: [{ text: answerPrompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 650 },
      });
      return NextResponse.json({ answer });
    } catch (error) {
      console.error("Agrimetry land story follow-up failed:", error);
      return NextResponse.json({ error: getGeminiError(error) }, {
        status: error?.status === 429 ? 429 : 502,
      });
    }
  }

  const center = centerOf(geometry);
  if (!center) {
    return NextResponse.json({ error: "Could not determine the selected field location." }, { status: 400 });
  }

  // Optional evidence is deliberately time-boxed. Sentinel-2 is the required
  // input; slow external providers must never consume the entire API timeout.
  const base = new URL(request.url).origin;
  const [soil, water, climate] = await Promise.all([
    optionalJson(`${base}/api/soil-health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field: { geometry } }),
    }),
    optionalJson(`${base}/api/water-stress?lat=${center.latitude}&lon=${center.longitude}&months=12`),
    optionalJson(`${base}/api/climate-history?lat=${center.latitude}&lon=${center.longitude}`),
  ]);

  evidence = [
    {
      id: "sentinel2_vegetation",
      source: EVIDENCE_SOURCES.sentinel2_vegetation,
      status: "available",
      data: trimVegetation(body.vegetationAnalysis),
      note: null,
    },
    {
      id: "soil_profile",
      source: EVIDENCE_SOURCES.soil_profile,
      status: soil.available ? "available" : "unavailable",
      data: soil.available ? compactEvidenceData("soil_profile", soil.data) : null,
      note: soil.error || null,
    },
    {
      id: "water_stress",
      source: EVIDENCE_SOURCES.water_stress,
      status: water.available ? "available" : "unavailable",
      data: water.available ? compactEvidenceData("water_stress", water.data) : null,
      note: water.error || null,
    },
    {
      id: "climate_history",
      source: EVIDENCE_SOURCES.climate_history,
      status: climate.available ? "available" : "unavailable",
      data: climate.available ? compactEvidenceData("climate_history", climate.data) : null,
      note: climate.error || null,
    },
  ];

  const evidenceIds = evidence.map((item) => item.id);
  const fieldName = String(body?.field?.name || "Selected field").slice(0, 80);
  const periodStart = String(body?.period?.start || "unknown");
  const periodEnd = String(body?.period?.end || "unknown");
  const evidenceJson = serializePromptEvidence(evidence);
  const prompt = `You are Agrimetry's evidence-first agricultural land storyteller. Write a specific, engaging story for the selected field using ONLY the supplied evidence. The field vegetation analysis is mandatory and has been completed. Connect observations across sources only where supported. Clearly distinguish direct observations from interpretations and background context. Never claim causation from correlation. Never invent measurements, dates, crop type, irrigation, disease, yield or recommendations. Explain missing sources honestly. For every chapter cite one or more evidence IDs from this list: ${evidenceIds.join(", ")}. Use plain, warm language suitable for a farmer, avoid generic filler, and create 4 to 6 narrative chapters with meaningful progression (what satellites saw, what the land profile adds, weather/water context, how clues may connect, what to inspect). If optional sources are unavailable, do not pretend they were measured. Field name: ${fieldName}. Period: ${periodStart} to ${periodEnd}. Evidence JSON: ${evidenceJson}`;

  try {
    const generatedText = await callGemini({
      apiKey,
      model,
      systemInstruction: {
        parts: [{ text: "You are Agrimetry's careful agricultural environmental storyteller. Follow the evidence and uncertainty rules exactly." }],
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2_400,
        responseMimeType: "application/json",
        responseSchema: STORY_SCHEMA,
      },
    });

    const story = validateStory(JSON.parse(generatedText), evidenceIds);
    return NextResponse.json({
      story,
      // The compact evidence is retained by the browser so follow-up questions
      // can reuse the same facts without refetching slow data services.
      evidence,
      generatedAt: new Date().toISOString(),
      model,
    });
  } catch (error) {
    console.error("Agrimetry land story generation failed:", error);
    return NextResponse.json({ error: getGeminiError(error) }, {
      status: error?.status === 429 ? 429 : 502,
    });
  }
}

