// Assembles the folder Cloudflare Pages serves. No dependencies, no bundler: the page is already
// static, this copies it and the assets it references into dist/.
import { cpSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const files = [
  "index.html",
  "favicon.svg",
  "globe-fallback.svg",
  "share.jpg",
  "sitemap.xml",
  "robots.txt",
];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const file of files) {
  const from = join(root, file);
  if (!existsSync(from)) throw new Error(`missing ${file}`);
  copyFileSync(from, join(dist, file));
}
cpSync(join(root, "assets"), join(dist, "assets"), { recursive: true });

console.log(`dist ready: ${files.length} files + assets`);
