// Builds the single-file playable prototype: engine bundle inlined into src/web/game.html.
import { build, transform } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const out = await build({ entryPoints: ["src/web/entry.ts"], bundle: true, format: "iife", globalName: "FT", minify: true, target: "es2020", write: false });
const engine = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
// Self-hosted fonts (SIL Open Font License), inlined so the page makes no font requests to third parties.
const face = (family, file, weight) => `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${readFileSync("node_modules/@fontsource/" + file).toString("base64")}) format("woff2")}`;
const fonts = [
  face("Silkscreen", "silkscreen/files/silkscreen-latin-400-normal.woff2", 400),
  face("Silkscreen", "silkscreen/files/silkscreen-latin-700-normal.woff2", 700),
  ...[600, 700, 800, 900].map((w) => face("Nunito", `nunito/files/nunito-latin-${w}-normal.woff2`, w)),
].join("\n");
// Minify the game's own CSS and script (about half the download on a phone).
let src = readFileSync("src/web/game.html", "utf8");
{
  const cssOpen = src.indexOf("<style>", src.indexOf("<style>/*__FONTS__*/</style>") + 10), cssClose = src.indexOf("</style>", cssOpen);
  const css = (await transform(src.slice(cssOpen + 7, cssClose), { loader: "css", minify: true })).code;
  src = src.slice(0, cssOpen + 7) + css + src.slice(cssClose);
  const jsOpen = src.indexOf("<script>", src.indexOf("/*__ENGINE__*/")), jsClose = src.lastIndexOf("</script>");
  const js = (await transform(src.slice(jsOpen + 8, jsClose), { loader: "js", minify: true, target: "es2020" })).code.replace(/<\/script/gi, "<\\/script");
  src = src.slice(0, jsOpen + 8) + js + src.slice(jsClose);
}
const html = src.replace("/*__FONTS__*/", () => fonts).replace("/*__ENGINE__*/", () => engine);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/friendly-takeover.html", html);
// Hosting (Vercel serves docs/, see vercel.json; GitHub Pages works too): the same game as index.html in docs/ and at the repo root, so it works
// whichever folder Pages is set to publish. .nojekyll serves the files as they are.
mkdirSync("docs", { recursive: true });
// (a full page with a charset, so a saved copy opened from disk shows € and emoji correctly)
// Vercel Web Analytics (cookieless visit counts); only on the hosted page, not the single-file copy.
const analytics = `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>\n<script defer src="/_vercel/insights/script.js"></script>\n`;
const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${analytics}${html}`;
writeFileSync("docs/index.html", page);
writeFileSync("index.html", page);
writeFileSync(".nojekyll", "");
writeFileSync("docs/.nojekyll", "");
console.log("dist/friendly-takeover.html", html.length, "bytes");
