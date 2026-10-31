// Builds the single-file playable prototype: engine bundle inlined into src/web/game.html.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const out = await build({ entryPoints: ["src/web/entry.ts"], bundle: true, format: "iife", globalName: "FT", minify: true, target: "es2020", write: false });
const engine = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync("src/web/game.html", "utf8").replace("/*__ENGINE__*/", () => engine);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/friendly-takeover.html", html);
// GitHub Pages: the same game as index.html in docs/ and at the repo root, so it works
// whichever folder Pages is set to publish. .nojekyll serves the files as they are.
mkdirSync("docs", { recursive: true });
writeFileSync("docs/index.html", html);
writeFileSync("index.html", html);
writeFileSync(".nojekyll", "");
writeFileSync("docs/.nojekyll", "");
console.log("dist/friendly-takeover.html", html.length, "bytes");
