const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_ORIGIN = "https://unite-db.com";

const DATASETS = [
  {
    name: "Pokemon",
    source: "/pokemon.json",
    output: "pokemon.json",
    validate(rows) {
      return rows.length >= 90
        && rows.every((row) => typeof row?.name === "string" && Array.isArray(row?.skills));
    }
  },
  {
    name: "stats",
    source: "/stats.json",
    output: "stats.json",
    validate(rows) {
      return rows.length >= 90
        && rows.every((row) => typeof row?.name === "string" && row?.level?.length === 15);
    }
  },
  {
    name: "held items",
    source: "/held_items.json",
    output: "held_items.json",
    validate(rows) {
      return rows.length >= 30 && rows.every((row) => typeof row?.name === "string");
    }
  },
  {
    name: "boost emblems",
    source: "/emblems.json",
    output: "emblems.json",
    validate(rows) {
      return rows.length >= 500
        && rows.every((row) => typeof row?.name === "string" && typeof row?.grade === "string");
    }
  },
  {
    name: "emblem sets",
    source: "/emblem_sets.json",
    output: "emblem_sets.json",
    validate(rows) {
      return rows.length >= 8 && rows.every((row) => typeof row?.name === "string");
    }
  }
];

async function fetchDataset(dataset) {
  const url = new URL(dataset.source, SOURCE_ORIGIN);
  const response = await fetch(url, {
    headers: { "cache-control": "no-cache" }
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);

  const text = await response.text();
  let rows;
  try {
    rows = JSON.parse(text);
  } catch (error) {
    throw new Error(`${url} did not return valid JSON: ${error.message}`);
  }
  if (!Array.isArray(rows) || !dataset.validate(rows)) {
    throw new Error(`${url} returned an unexpected ${dataset.name} data structure`);
  }

  return { dataset, rows, text: text.trim() };
}

async function main() {
  const downloads = await Promise.all(DATASETS.map(fetchDataset));

  for (const { dataset, rows, text } of downloads) {
    const outputPath = path.join(ROOT, "data", dataset.output);
    const previous = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
    if (previous === text) {
      console.log(`Unchanged: ${dataset.output} (${rows.length} records)`);
      continue;
    }
    fs.writeFileSync(outputPath, text);
    console.log(`Updated: ${dataset.output} (${rows.length} records)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
