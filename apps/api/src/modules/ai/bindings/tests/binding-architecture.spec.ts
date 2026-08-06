import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [join(directory, entry.name)] : []);

describe('Capability binding architecture', () => {
  it('does not leak binding imports into planner production source', () => {
    const plannerRoot = join(__dirname, '..', '..', 'planner');
    const source = files(plannerRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(/bindings|CapabilityBinding|ReadPlanRunner|ToolRegistry|ToolDefinition|ToolExecutionService/);
  });

  it('does not expose a capability execution controller', () => {
    const controller = readFileSync(join(__dirname, '..', '..', 'ai.controller.ts'), 'utf8');
    expect(controller).not.toMatch(/CapabilityBinding|ReadPlanRunner|execute-capability|capabilities\/execute/);
  });

  it('contains no business repository mutation calls', () => {
    const bindingRoot = join(__dirname, '..');
    const source = files(bindingRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(/\.(watch|deal|payment|accountEntry|accountPayment|treasuryEntry|operatingExpense)\.(create|update|delete)/);
  });
});
