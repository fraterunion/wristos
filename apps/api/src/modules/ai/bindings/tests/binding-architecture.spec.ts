import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [join(directory, entry.name)] : []);

describe('Capability binding architecture', () => {
  it('does not leak binding imports into planner production source', () => {
    const plannerRoot = join(__dirname, '..', '..', 'planner');
    const source = files(plannerRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(/bindings|CapabilityBinding|ReadPlanRunner|WritePlanRunner|ToolRegistry|ToolDefinition|ToolExecutionService|SaleRegistrationService/);
  });

  it('does not leak write execution into intent-adapter production source', () => {
    const intentRoot = join(__dirname, '..', '..', 'intent-adapter');
    const source = files(intentRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(
      /WritePlanRunner|WriteCapabilityBinding|SaleRegistrationService|ClientRegistrationService|register-sale\.binding|create-client\.binding/,
    );
  });

  it('does not import ClientRegistrationService from planner production source', () => {
    const plannerRoot = join(__dirname, '..', '..', 'planner');
    const source = files(plannerRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(/ClientRegistrationService|create-client\.binding/);
  });

  it('does not import ClientUpdateService from planner or intent-adapter production source', () => {
    const plannerRoot = join(__dirname, '..', '..', 'planner');
    const intentRoot = join(__dirname, '..', '..', 'intent-adapter');
    const plannerSource = files(plannerRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    const intentSource = files(intentRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(plannerSource).not.toMatch(/ClientUpdateService|update-client\.binding/);
    expect(intentSource).not.toMatch(/ClientUpdateService|update-client\.binding/);
  });

  it('does not expose a capability execution controller', () => {
    const controller = readFileSync(join(__dirname, '..', '..', 'ai.controller.ts'), 'utf8');
    expect(controller).not.toMatch(/ReadPlanRunner|execute-capability|capabilities\/execute/);
    expect(controller).not.toMatch(/CapabilityBindingService/);
    expect(controller).toMatch(/WritePlanRunner/);
  });

  it('contains no direct business repository mutation calls in bindings', () => {
    const bindingRoot = join(__dirname, '..');
    const source = files(bindingRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(/\.(watch|deal|payment|accountEntry|accountPayment|treasuryEntry|operatingExpense)\.(create|update|delete)\b/);
  });
});
