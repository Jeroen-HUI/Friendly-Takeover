// Builds the single-file playable prototype: engine bundle inlined into src/web/game.html.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const out = await build({ entryPoints: ["src/web/entry.ts"], bundle: true, format: "iife", globalName: "FT", minify: true, target: "es2020", write: false });
const engine = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync("src/web/game.html", "utf8").replace("/*__ENGINE__*/", () => engine);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/friendly-takeover.html", html);
// GitHub Pages serves the docs/ folder: the same game as index.html.
mkdirSync("docs", { recursive: true });
writeFileSync("docs/index.html", html);
console.log("dist/friendly-takeover.html", html.length, "bytes");
