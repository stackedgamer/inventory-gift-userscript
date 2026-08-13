import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const metadata = await readFile(new URL("src/metadata.txt", root), "utf8");
const core = await readFile(new URL("src/core.js", root), "utf8");
const main = await readFile(new URL("src/main.js", root), "utf8");
const bundledCore = core.replaceAll(/^export /gm, "");
const output = `${metadata.trim()}\n\n(() => {\n\"use strict\";\n\n${bundledCore}\n\n${main}\n})();\n`;

await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(new URL("dist/inventory-gift.user.js", root), output);