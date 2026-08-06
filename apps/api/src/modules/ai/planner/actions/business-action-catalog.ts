import { Injectable, NotFoundException } from '@nestjs/common';
import { BUSINESS_ACTIONS } from './business-actions';
import { BusinessActionDefinition } from './business-action-definition';

@Injectable()
export class BusinessActionCatalog {
  private readonly actions = new Map(BUSINESS_ACTIONS.map((action) => [action.id, action]));

  get(id: string): BusinessActionDefinition {
    const action = this.actions.get(id as never);
    if (!action) throw new NotFoundException(`Unknown business action: ${id}`);
    return action;
  }

  list(): readonly BusinessActionDefinition[] {
    return [...this.actions.values()];
  }
}
