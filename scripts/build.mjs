import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist");

await fs.rm(out, {recursive:true, force:true});
await fs.mkdir(out, {recursive:true});

for(const name of ["index.html", "_headers", "manifest.webmanifest", "sw.js"])
  await fs.copyFile(path.join(root, name), path.join(out, name));
for(const name of ["css", "js", "data", "icons"])
  await fs.cp(path.join(root, name), path.join(out, name), {recursive:true});

await fs.writeFile(path.join(out, ".nojekyll"), "");
console.log("ok: built static site in dist/");
