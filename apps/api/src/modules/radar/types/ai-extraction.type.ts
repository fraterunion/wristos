export type AiIntent = 'SELL_OFFER' | 'BUY_REQUEST' | 'PRICE_SIGNAL' | 'GENERAL_INQUIRY' | 'IRRELEVANT';

export interface AiExtractionResult {
  intent: AiIntent;
  confidence: number; // 0-1
  brand: string | null;
  model: string | null;
  referenceNumberExplicit: string | null; // only if sender literally wrote a ref number
  rawModelMention: string | null; // verbatim watch mention from message
  priceAmount: number | null;
  priceCurrency: string | null;
  urgencyDetected: boolean;
  conditionNotes: string | null;
  hasBox: boolean | null;
  hasPapers: boolean | null;
  year: number | null;
  aiSummary: string; // one-sentence summary
}
