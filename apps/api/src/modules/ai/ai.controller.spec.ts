import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AIController } from './ai.controller';
import { HttpStatus } from '@nestjs/common';

describe('AIController public action-run API', () => {
  it('exposes semantic confirm/cancel commands and no generic status mutation', () => {
    const prototype = AIController.prototype as unknown as Record<string, object>;
    const routes = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ path: Reflect.getMetadata(PATH_METADATA, prototype[name]), method: Reflect.getMetadata(METHOD_METADATA, prototype[name]) }));

    expect(routes).toEqual(expect.arrayContaining([
      { path: 'action-runs/:id/confirm', method: RequestMethod.POST },
      { path: 'action-runs/:id/cancel', method: RequestMethod.POST },
    ]));
    expect(routes).not.toEqual(expect.arrayContaining([{ path: 'action-runs/:id/status', method: expect.anything() }]));
    expect(routes).toEqual(expect.arrayContaining([{ path: 'assistant/structured', method: RequestMethod.POST }]));
    expect(routes).toEqual(expect.arrayContaining([{ path: 'assistant/message', method: RequestMethod.POST }]));
    expect(prototype).not.toHaveProperty('transitionActionRun');
  });

  it('maps a durable typed NOT_FOUND response to HTTP 404 without changing its body', async () => {
    const typedResponse = { requestId: 'request-1', conversationId: '', workspaceId: '', interactionState: 'FAILED', responseType: 'ERROR_RECOVERY_CARD', payload: { errorType: 'NOT_FOUND', message: 'No se encontró el recurso solicitado.' }, warnings: [], suggestedActions: [], traceId: 'trace-1', createdAt: '2026-08-06T00:00:00.000Z' };
    const assistant = { execute: jest.fn().mockResolvedValue(typedResponse) };
    const controller = new AIController({} as never, {} as never, {} as never, assistant as never, {} as never);
    const httpResponse = { status: jest.fn() };
    const result = await controller.structuredAssistant({ userId: 'u1', tenantId: 't1', email: 'u@example.test' }, { intent: 'GET_LIQUIDITY', entities: {}, surface: 'API', clientRequestId: 'request-1' }, httpResponse as never);
    expect(httpResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(result).toBe(typedResponse);
  });

  it('maps a durable typed conflict response from the natural-language endpoint to HTTP 409', async () => {
    const typedResponse = { requestId: 'request-2', conversationId: '', workspaceId: '', interactionState: 'FAILED', responseType: 'ERROR_RECOVERY_CARD', payload: { errorType: 'CONFLICT', message: 'El estado cambió.' }, warnings: [], suggestedActions: [], traceId: 'trace-2', createdAt: '2026-08-06T00:00:00.000Z' };
    const naturalLanguageAssistant = { handleMessage: jest.fn().mockResolvedValue({ resolvedIntent: 'GET_LIQUIDITY', response: typedResponse }) };
    const controller = new AIController({} as never, {} as never, {} as never, {} as never, naturalLanguageAssistant as never);
    const httpResponse = { status: jest.fn() };
    const result = await controller.assistantMessage({ userId: 'u1', tenantId: 't1', email: 'u@example.test' }, { text: 'Muéstrame mi liquidez', surface: 'MOBILE', clientRequestId: 'request-2' } as never, httpResponse as never);
    expect(httpResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(result).toEqual({ resolvedIntent: 'GET_LIQUIDITY', response: typedResponse });
  });
});
