// Plain-text exports of an Evidence Passport. Pure functions.

const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "n/a");

export function passportToMarkdown(passport) {
  const L = [];
  const classLabel = (key) => passport.classes[key]?.label || key;
  L.push(`# Agrimetry Evidence Passport`);
  L.push("");
  L.push(`- **Passport ID:** ${passport.id}`);
  L.push(`- **Generated:** ${passport.generatedAt}`);
  L.push(`- **Field:** ${passport.field.name}${Number.isFinite(passport.field.areaHa) ? ` (${passport.field.areaHa.toFixed(1)} ha)` : ""} at ${passport.field.centre.latitude.toFixed(4)}, ${passport.field.centre.longitude.toFixed(4)}`);
  L.push(`- **Evidence confidence:** ${passport.confidence.level} (${passport.confidence.score} of ${passport.confidence.max} data points). ${passport.confidence.explanation}`);
  L.push("");
  L.push(`> **Validate locally.** ${passport.validationReminder}`);
  L.push("");
  L.push(`## Kinds of evidence`);
  for (const [key, value] of Object.entries(passport.classes)) L.push(`- **${value.label}:** ${value.detail}`);
  L.push("");
  L.push(`## Data behind this passport`);
  L.push("| Dataset | Provider | Kind | NASA | Status | Used for |");
  L.push("|---|---|---|---|---|---|");
  for (const s of passport.sources) L.push(`| ${s.name} | ${s.provider} | ${classLabel(s.class)} | ${s.nasa ? "yes" : "no"} | ${s.status} | ${s.usedFor} |`);
  L.push("");
  L.push(`## Your inputs`);
  L.push(`- Crops per year: ${passport.inputs.seasonsPerYear}; irrigation: ${passport.inputs.irrigation}`);
  L.push(`- Current rotation: ${passport.entries.find((e) => e.role === "current")?.crops.join(" → ") || "n/a"}`);
  L.push(`- Priorities (1–5): ${Object.entries(passport.inputs.priorities).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  L.push(`- Crops you can sell: ${passport.inputs.marketCrops?.length ? passport.inputs.marketCrops.join(", ") : "not provided"}`);
  L.push(`- Equipment: ${passport.inputs.equipment ? (passport.inputs.equipment.join(", ") || "none listed") : "not specified"}`);
  if (passport.observationCheck) { L.push(""); L.push(`> **Satellite reality check (${passport.observationCheck.status}).** ${passport.observationCheck.text}`); }
  for (const notice of passport.notices) { L.push(""); L.push(`> **Notice.** ${notice}`); }
  for (const entry of passport.entries) {
    L.push("");
    L.push(`---`);
    L.push(`## ${entry.role === "current" ? "Current rotation (reference)" : "Suggested rotation"}: ${entry.label}`);
    L.push(`**${entry.crops.join(" → ")}** — score ${entry.total.toFixed(0)} / 100`);
    L.push("");
    L.push(`| Slot | When | Crop | Sow – harvest | Climate fit | Soil fit |`);
    L.push(`|---|---|---|---|---|---|`);
    for (const s of entry.schedule) L.push(`| ${s.slot} | ${s.season} | ${s.crop} | ${s.sow ? `${s.sow} – ${s.harvest}` : "n/a"} | ${s.climateFit}% | ${s.soilFit === null ? "unknown" : `${s.soilFit}%`} |`);
    if (entry.why.length) {
      L.push("");
      L.push(`### Why this rotation was suggested`);
      for (const w of entry.why) L.push(`- **${w.criterion}:** ${w.text}`);
    }
    L.push("");
    L.push(`### Evidence for each claim`);
    for (const item of entry.evidenceLedger) L.push(`- **${item.claim}** — ${item.evidence} _(${item.classes.map(classLabel).join(" + ") || "no data"})_`);
    L.push("");
    L.push(`### NASA and other datasets supporting this`);
    for (const d of entry.supportingDatasets) L.push(`- ${d.name} (${classLabel(d.class)}${d.nasa ? ", NASA" : ""})`);
    L.push("");
    L.push(`### Historical conditions considered`);
    const h = entry.history.summary;
    L.push(`- ${h.seasonsAnalysed} past crop seasons replayed: ${pct(h.favourableShare)} favourable, ${pct(h.unfavourableShare)} unfavourable, ${h.badYears.length} widespread bad year${h.badYears.length === 1 ? "" : "s"}${h.worstCrop ? `; weakest crop ${h.worstCrop.name}` : ""}.`);
    for (const c of entry.history.scenarios) L.push(`- ${entry.history.scenarioLabels.find((l) => l.key === c.key)?.label}: ${pct(c.notFavourableShare)} of seasons not favourable (match ${Math.round(c.meanFit * 100)}%).`);
    if (entry.benefits.length || entry.tradeoffs.length) {
      L.push("");
      L.push(`### Potential soil and water effects (vs your current rotation)`);
      for (const b of entry.benefits) L.push(`- **Benefit — ${b.area}:** ${b.text}`);
      for (const b of entry.tradeoffs) L.push(`- **Trade-off — ${b.area}:** ${b.text}`);
    }
    L.push("");
    L.push(`### Risks`);
    L.push(...(entry.risks.length ? entry.risks.map((r) => `- ${r}`) : ["- None flagged by the available data."]));
    L.push("");
    L.push(`### Uncertainties`);
    L.push(...entry.uncertainties.map((r) => `- ${r}`));
    L.push("");
    L.push(`### Missing information`);
    L.push(...entry.missing.map((r) => `- ${r}`));
    L.push("");
    L.push(`### Questions to ask a local agronomist`);
    L.push(...entry.questions.map((r) => `- ${r}`));
  }
  L.push("");
  L.push(`---`);
  L.push(`## Assumptions`);
  L.push(...passport.assumptions.map((a) => `- ${a}`));
  L.push("");
  L.push(`> ${passport.validationReminder}`);
  return L.join("\n");
}
