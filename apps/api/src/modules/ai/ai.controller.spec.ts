import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AIController } from './ai.controller';

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
    expect(prototype).not.toHaveProperty('transitionActionRun');
  });
});
