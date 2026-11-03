// Friendly Takeover — the chat censor's word list (slurs and hate, not ordinary swearing).
// Used by the game (src/web/game.html, generated block) and the database (supabase migration, generated).
// Run: node scripts/censor-list.mjs  → prints the JS and SQL pattern lists.
// Letters may be swapped for look-alikes (n1gg3r) or split with dots/dashes (n.i.g.g.e.r); spaces don't count as a split,
// so normal words next to each other never trigger it.

const LOOK = { a: "a4@", e: "e3", i: "i1!|l", o: "o0", s: "s5$", g: "g9", t: "t7", b: "b8", z: "z2" };
const SEP = "[._*~\\-]*";
const letter = (c) => (LOOK[c] ? `[${LOOK[c].replace(/[\\\]^-]/g, "\\$&")}]+` : c === " " ? "\\s*" : `${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}+`);
const word = (w) => [...w].map(letter).join(SEP);
// The rest of the word, also when it's split with dots (n.i.g.g.e.r).
const TAIL = "(?:" + SEP + "\\w)*";

// [pattern, where]: "any" = anywhere (also inside longer words), "word" = only as its own word, "start" = at a word start, rest of the word too.
export const ENTRIES = [
  // English racial slurs
  [word("nigg") + "(?!l)" + TAIL, "any"], [word("nikker") + TAIL, "start"], [word("niglet"), "any"],
  [word("negro") + "(es)?", "word"], [word("chink") + "s?", "word"], [word("gook") + "s?", "word"], [word("spic") + "s?", "word"],
  [word("kike") + "s?", "word"], [word("wetback") + "s?", "any"], [word("coon") + "s?", "word"], [word("paki") + "s?", "word"],
  [word("towelhead") + "s?", "any"], [word("raghead") + "s?", "any"], [word("jigaboo") + "s?", "any"], [word("beaner") + "s?", "word"],
  [word("porch monkey") + "s?", "any"], [word("jungle bunny"), "any"], [word("sand monkey"), "any"], [word("zipperhead") + "s?", "any"],
  // Homophobic / transphobic slurs
  [word("faggot") + "s?", "any"], [word("fagot") + "s?", "word"], [word("fag") + "s?", "word"], [word("tranny"), "word"], [word("trannies"), "word"],
  // Dutch
  // Exact letters (no doubled vowels), so the verb "negeren" / "ik negeer" is never hit.
  ["n[e3]g[e3]r(?!en|end)\\w*", "any"], [word("negerin"), "any"], [word("makaak") + "(en)?", "word"], [word("flikker") + "s?", "word"],
  ["(kanker|kut|vuile|rot|tering)\\s*" + "(jo+de?n?|marok\\w*|turk\\w*|zigeuner\\w*|homo\\w*)", "any"],
  // Hate slogans
  [word("heil hitler"), "any"], [word("sieg heil"), "any"], ["gas\\s+(the|de|alle)\\s+jo?(ews|oden)", "any"], ["white\\s+power", "any"], ["\\b1488\\b", "any"],
];

export const js = ENTRIES.map(([p, w]) => (w === "word" ? `\\b${p}\\b` : w === "start" ? `\\b${p}` : p));
// Postgres uses \y for a word boundary.
export const sql = ENTRIES.map(([p, w]) => (w === "word" ? `\\y${p}\\y` : w === "start" ? `\\y${p}` : p).replace(/\\b/g, "\\y"));

if (process.argv[1] && process.argv[1].endsWith("censor-list.mjs")) {
  console.log(JSON.stringify({ js, sql }, null, 1));
}
