const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_URL = "https://unite-db.com/patch-notes";
const OUTPUT_PATH = path.join(ROOT, "data", "patch_notes.json");

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, "");
}

function cleanHeading(value) {
  return String(value || "")
    .replace(/\\?\[(BUFFED|NERFED|ADJUSTED|REWORKED|BUGFIX(?:ES)?|NEW|INTRODUCED)\\?\]/gi, "")
    .replace(/[*_`]/g, "")
    .replace(/[:：\-\s]+$/g, "")
    .trim();
}

function statusFromText(value) {
  const match = String(value || "").match(/\\?\[(BUFFED|NERFED|ADJUSTED|REWORKED|BUGFIX(?:ES)?|NEW|INTRODUCED)\\?\]/i);
  const status = match ? match[1].toUpperCase() : "ADJUSTED";
  if (status === "BUFFED") return "buff";
  if (status === "NERFED") return "nerf";
  if (status.startsWith("BUGFIX")) return "bugfix";
  if (status === "REWORKED") return "rework";
  if (status === "NEW" || status === "INTRODUCED") return "new";
  return "adjustment";
}

function cleanDetailLine(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/^[-*+]\s+/, "")
    .replace(/[*_`]/g, "")
    .replace(/\\([\[\]])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function createPokemonResolver(pokemonRows) {
  const aliases = new Map();
  const add = (label, names) => aliases.set(normalizeName(label), Array.isArray(names) ? names : [names]);
  pokemonRows.forEach((pokemon) => {
    add(pokemon.name, pokemon.name);
    if (pokemon.display_name) add(pokemon.display_name, pokemon.name);
  });
  [
    ["Alolan Ninetales", "Ninetales"], ["Alolan Raichu", "Raichu"], ["Raichu (Alolan)", "Raichu"],
    ["Galarian Rapidash", "Rapidash"], ["Rapidash (Galarian)", "Rapidash"],
    ["Mega Charizard X", "Mega-Charizard-X"], ["Mega Charizard Y", "Mega-Charizard-Y"],
    ["Mega Gyarados", "Mega-Gyarados"], ["Mega Lucario", "Mega-Lucario"],
    ["Mewtwo X", "MewtwoX"], ["Mega Mewtwo X", "MewtwoX"],
    ["Mewtwo Y", "MewtwoY"], ["Mega Mewtwo Y", "MewtwoY"], ["Mewtwo whY", "MewtwoY"],
    ["Mr Mime", "Mr.Mime"], ["Ho-oh", "Ho-Oh"],
    ["Scyther / Scizor", ["Scyther", "Scizor"]], ["Scizor / Scyther", ["Scizor", "Scyther"]],
    ["Scyther/Scizor", ["Scyther", "Scizor"]], ["Mewtwo X & Y", ["MewtwoX", "MewtwoY"]],
    ["Eldegoss, Gengar, Cramorant, Blastoise, Sylveon", ["Eldegoss", "Gengar", "Cramorant", "Blastoise", "Sylveon"]]
  ].forEach(([label, names]) => add(label, names));
  return (heading) => aliases.get(normalizeName(cleanHeading(heading))) || [];
}

const GENERAL_HEADINGS = new Set([
  "general changes", "general bugfixes", "bug fixes", "bugfixes", "pokemon", "items", "held items",
  "battle items", "battle item", "objectives", "wild pokemon", "map", "goal zones", "other notes",
  "undocumented changes", "site updates", "ui improvements", "quality of life", "gamemodes", "draft",
  "ranking system", "matchmaking", "communication", "experience system adjustments", "exp", "all pokemon"
].map(normalizeName));

function extractPatch(post, resolvePokemon) {
  const pokemonChanges = new Map();
  let activePokemon = [];
  let currentChange = null;
  const addChange = (heading) => {
    const change = { move: cleanHeading(heading) || "General Adjustments", status: statusFromText(heading), details: [] };
    activePokemon.forEach((name) => {
      if (!pokemonChanges.has(name)) pokemonChanges.set(name, []);
      pokemonChanges.get(name).push(change);
    });
    currentChange = change;
  };

  String(post.patchNoteDetails || "").split(/\r?\n/).forEach((rawLine) => {
    const headingMatch = rawLine.match(/^\s*(#{2,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = headingMatch[2];
      const resolvedPokemon = level <= 4 ? resolvePokemon(heading) : [];
      if (resolvedPokemon.length) {
        activePokemon = resolvedPokemon;
        currentChange = null;
      } else if (level <= 2 || GENERAL_HEADINGS.has(normalizeName(cleanHeading(heading)))) {
        activePokemon = [];
        currentChange = null;
      } else if (activePokemon.length) {
        addChange(heading);
      }
      return;
    }
    if (!activePokemon.length) return;
    const line = cleanDetailLine(rawLine);
    if (!line) return;
    if (!currentChange) addChange("General Adjustments");
    currentChange.details.push(line);
  });

  const pokemon = [...pokemonChanges.entries()].map(([name, changes]) => ({
    name,
    changes: changes.map((change) => ({ ...change, details: [...new Set(change.details)] }))
      .filter((change) => change.details.length || change.move !== "General Adjustments")
  })).filter((entry) => entry.changes.length);
  const versionMatch = String(post.title || "").match(/Patch\s+([0-9.]+)/i);
  return {
    version: versionMatch ? versionMatch[1] : String(post.title || "").replace(/^Patch\s*/i, "").trim(),
    date: post.patchDate || "",
    slug: post.slug || "",
    pokemon
  };
}

async function main() {
  const pageResponse = await fetch(SOURCE_URL);
  if (!pageResponse.ok) throw new Error(`Patch notes page returned HTTP ${pageResponse.status}`);
  const html = await pageResponse.text();
  const payloadMatch = html.match(/(?:src|href)="([^"]+\/patch-notes\/payload\.js)"/);
  if (!payloadMatch) throw new Error("Patch notes payload URL was not found");
  const payloadUrl = new URL(payloadMatch[1], SOURCE_URL).href;
  const payloadResponse = await fetch(payloadUrl);
  if (!payloadResponse.ok) throw new Error(`Patch notes payload returned HTTP ${payloadResponse.status}`);
  let nuxtData = null;
  vm.runInNewContext(await payloadResponse.text(), {
    __NUXT_JSONP__: (route, data) => { if (route === "/patch-notes") nuxtData = data; }
  });
  const posts = nuxtData?.data?.[0]?.posts?.map((post) => post.fields) || [];
  if (!posts.length) throw new Error("No patch note posts were found");
  const pokemonRows = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "pokemon.json"), "utf8"));
  const resolvePokemon = createPokemonResolver(pokemonRows);
  const patches = posts.map((post) => extractPatch(post, resolvePokemon))
    .filter((patch) => patch.pokemon.length).sort((a, b) => b.date.localeCompare(a.date));
  const output = { source: SOURCE_URL, fetchedAt: new Date().toISOString().slice(0, 10), patchCount: posts.length, patches };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  const pokemonCount = new Set(patches.flatMap((patch) => patch.pokemon.map((entry) => entry.name))).size;
  console.log(`Wrote ${patches.length} patches for ${pokemonCount} Pokemon to ${OUTPUT_PATH}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
