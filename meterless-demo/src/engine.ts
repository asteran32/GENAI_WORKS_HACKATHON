// Engine loader. After `npm run setup`, the H-MEM reference lives in
// vendor/hmem (degit copy). Inside the monorepo, the sibling path works
// without setup. The startup line names which source loaded, so nobody
// debugs the wrong copy.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot=path.resolve(here,"../..");
const workspaceEngine=path.basename(path.dirname(projectRoot))===".publish"?path.resolve(projectRoot,"../../meterless-demo/vendor/hmem/src/index.ts"):null;
const CANDIDATES = [
  { label: "vendor/hmem", entry: path.join(here, "..", "vendor", "hmem", "src", "index.ts") },
  ...(workspaceEngine?[{label:"workspace H-MEM",entry:workspaceEngine}]:[]),
  { label: "monorepo sibling", entry: path.join(here, "..", "..", "..", "engines", "hmem", "reference", "src", "index.ts") },
];

export interface LoadedEngine {
  HMEM: new (opts: { clock?: () => number; persistDir?: string; actor?: string }) => any;
  source: string;
  embed: (text: string) => any;
}

export async function loadHMEM(): Promise<LoadedEngine> {
  for (const c of CANDIDATES) {
    if (fs.existsSync(c.entry)) {
      const mod = await import(pathToFileURL(c.entry).href);
      const {embed}=await import(pathToFileURL(path.join(path.dirname(c.entry),"embeddings.ts")).href);
      return { HMEM: mod.HMEM, embed, source: c.label };
    }
  }
  console.error("H-MEM engine not found. Run the setup step first:\n\n  npm run setup\n");
  console.error("(It vendors the reference implementation into vendor/hmem via degit.)");
  process.exit(1);
}
