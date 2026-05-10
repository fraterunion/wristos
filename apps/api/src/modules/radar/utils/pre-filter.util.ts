import { looksLikePriceSignal } from './price-extractor.util';

// Minimum message length to be worth classifying (very short messages are noise)
const MIN_CONTENT_LENGTH = 10;

// Brand keyword tokens — single source of truth for pre-filter
const BRAND_TOKENS = [
  'rolex', 'audemars', 'piguet', 'patek', 'philippe', 'cartier',
  'richard mille', 'rm ', 'omega', 'tudor',
  'daytona', 'submariner', 'gmt', 'datejust', 'explorer', 'milgauss',
  'skydweller', 'sky-dweller', 'yachtmaster', 'pearlmaster',
  'royal oak', 'offshore', 'perpetual calendar',
  'nautilus', 'aquanaut', 'calatrava', 'grand complications',
  'santos', 'tank', 'ballon bleu', 'panthère', 'drive',
  'speedmaster', 'seamaster', 'constellation',
  'black bay', 'pelagos', 'ranger', 'glamour',
  // Common watch trade intent signals
  'wts', 'wtb', 'wtt', 'for sale', 'selling', 'buying', 'trade',
  'asking', 'offer', 'interested', 'price', 'deal', 'availability',
];

const INTENT_TOKENS = [
  'for sale', 'selling', 'wts', 'sell',
  'looking for', 'wtb', 'buying', 'buy',
  'price', 'asking', 'offer', 'deal',
  'available', 'availability', 'interested',
  'trade', 'wtt', 'swap',
];

export function passesPredicate(content: string): boolean {
  if (content.trim().length < MIN_CONTENT_LENGTH) return false;

  const lower = content.toLowerCase();

  const hasBrandSignal = BRAND_TOKENS.some((t) => lower.includes(t));
  const hasIntentSignal = INTENT_TOKENS.some((t) => lower.includes(t));
  const hasPriceSignal = looksLikePriceSignal(content);

  return hasBrandSignal || hasIntentSignal || hasPriceSignal;
}
