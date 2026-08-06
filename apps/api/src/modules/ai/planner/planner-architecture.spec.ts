import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return sourceFiles(path);
  return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
});

describe('Planner architecture boundary', () => {
  it('contains no imports or contracts from the implementation-tool layer', () => {
    const source = sourceFiles(__dirname).map((path) => readFileSync(path, 'utf8')).join('\n');
    const forbidden = [['Tool', 'Registry'], ['Tool', 'Definition'], ['Tool', 'ExecutionService'], ['tool', 'Name'], ['/ai/', 'tools/']].map((parts) => parts.join(''));
    for (const token of forbidden) expect(source).not.toContain(token);
  });

  it('contains no persistence or business mutation calls', () => {
    const source = sourceFiles(__dirname).map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(/\bprisma\b|\.(create|update|delete|execute)\s*\(/);
  });
});
