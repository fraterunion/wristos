import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessCapability } from '../planner.types';

export interface BusinessCapabilityDefinition {
  id: BusinessCapability;
  name: string;
  description: string;
  category: string;
}

const capability = (id: BusinessCapability, name: string, category: string): BusinessCapabilityDefinition => ({ id, name, category, description: `${name} business capability.` });

export const BUSINESS_CAPABILITIES: readonly BusinessCapabilityDefinition[] = [
  capability('GET_LIQUIDITY', 'Get Liquidity', 'FINANCE'),
  capability('GET_MONTHLY_PROFIT', 'Get Monthly Profit', 'ANALYTICS'),
  capability('SEARCH_INVENTORY', 'Search Inventory', 'INVENTORY'),
  capability('SEARCH_CLIENT', 'Search Client', 'CRM'),
  capability('GET_CLIENT_ACCOUNTS', 'Get Client Accounts', 'ACCOUNTS'),
  capability('GET_INVENTORY_AGING', 'Get Inventory Aging', 'INVENTORY'),
  capability('GET_TOP_INVENTORY_CAPITAL', 'Get Top Inventory Capital', 'INVENTORY'),
  capability('GET_TOP_DEBTORS', 'Get Top Debtors', 'ACCOUNTS'),
  capability('GET_RECEIVABLE_SUMMARY', 'Get Receivable Summary', 'ACCOUNTS'),
  capability('GET_SALES_MARGIN_SUMMARY', 'Get Sales Margin Summary', 'ANALYTICS'),
  capability('GET_PROFIT_BY_BRAND', 'Get Profit By Brand', 'ANALYTICS'),
  capability('GET_TOP_SALES', 'Get Top Sales', 'SALES'),
  capability('GET_ATTENTION_ITEMS', 'Get Attention Items', 'ANALYTICS'),
  capability('GET_BUSINESS_SUMMARY', 'Get Business Summary', 'ANALYTICS'),
  capability('REGISTER_SALE', 'Register Sale', 'SALES'),
  capability('REGISTER_RECEIVABLE_PAYMENT', 'Register Receivable Payment', 'ACCOUNTS'),
  capability('REGISTER_PURCHASE', 'Register Purchase', 'INVENTORY'),
  capability('REGISTER_EXPENSE', 'Register Expense', 'EXPENSES'),
  capability('REGISTER_SETTLEMENT', 'Register Settlement', 'ACCOUNTS'),
  capability('REGISTER_CRYPTO_POSITION', 'Register Crypto Position', 'TREASURY'),
  capability('REGISTER_CRYPTO_PRICE', 'Register Crypto Price', 'TREASURY'),
];

@Injectable()
export class BusinessCapabilityCatalog {
  private readonly capabilities = new Map(BUSINESS_CAPABILITIES.map((entry) => [entry.id, entry]));

  get(id: string): BusinessCapabilityDefinition {
    const entry = this.capabilities.get(id as BusinessCapability);
    if (!entry) throw new NotFoundException(`Unknown business capability: ${id}`);
    return entry;
  }

  list(): readonly BusinessCapabilityDefinition[] {
    return [...this.capabilities.values()];
  }
}
