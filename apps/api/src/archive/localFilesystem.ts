import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ObservationArchive } from "./types.js";

export class LocalFilesystemArchive implements ObservationArchive {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    const p = path.resolve(this.rootDir, key);
    if (!p.startsWith(path.resolve(this.rootDir) + path.sep)) {
      throw new Error(`archive key escapes root: ${key}`);
    }
    return p;
  }

  async putObject(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async getObject(key: string): Promise<Uint8Array> {
    return readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolve(key));
  }

  async list(prefix: string): Promise<string[]> {
    const base = path.resolve(this.rootDir, prefix);
    if (!existsSync(base)) return [];
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push(path.relative(this.rootDir, full));
      }
    };
    await walk(base);
    return out.sort();
  }
}
