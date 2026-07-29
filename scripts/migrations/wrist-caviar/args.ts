import * as fs from 'fs';
import * as path from 'path';

export type ArgMap = Record<string, string | boolean>;

export function parseArgs(argv: string[]): ArgMap {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function requireArg(args: ArgMap, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v) {
    throw new Error(`Missing required --${key}`);
  }
  return v;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//***:***@${u.hostname}:${u.port || ''}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

export function databaseHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
