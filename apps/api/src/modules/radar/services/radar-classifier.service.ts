import { Injectable, Logger } from '@nestjs/common';
import { ClassificationStatus, MarketListingIntent, Prisma, ReviewStatus } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiExtractionResult, AiIntent } from '../types/ai-extraction.type';
import { passesPredicate } from '../utils/pre-filter.util';
import { RadarNormalizerService } from './radar-normalizer.service';

const MODEL = 'claude-haiku-4-5-20251001';

// feedConfidence threshold for downstream routing
const CONFIDENCE_HIGH = 0.75;

const SYSTEM_PROMPT = `You are a luxury watch market intelligence assistant for a professional watch dealer.
You analyze WhatsApp group messages to identify buy/sell/price signals.

Respond ONLY with valid JSON matching this exact schema:
{
  "intent": "SELL_OFFER" | "BUY_REQUEST" | "PRICE_SIGNAL" | "GENERAL_INQUIRY" | "IRRELEVANT",
  "confidence": <float 0-1>,
  "brand": <string|null>,
  "model": <string|null>,
  "referenceNumberExplicit": <string|null>,
  "rawModelMention": <string|null>,
  "priceAmount": <number|null>,
  "priceCurrency": <string|null>,
  "urgencyDetected": <boolean>,
  "conditionNotes": <string|null>,
  "hasBox": <boolean|null>,
  "hasPapers": <boolean|null>,
  "year": <integer|null>,
  "aiSummary": <string>
}

Rules:
- referenceNumberExplicit: populate ONLY if the sender literally writes a reference number (e.g. "116610LV", "RM 027"). Do NOT infer from model names.
- rawModelMention: the verbatim watch mention from the message (e.g. "Submariner Kermit", "Royal Oak 15202")
- IRRELEVANT: use when the message has no watch market relevance at all
- confidence: reflect how certain you are of the intent classification
- aiSummary: one sentence, professional tone`;

@Injectable()
export class RadarClassifierService {
  private readonly logger = new Logger(RadarClassifierService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly prisma: PrismaService,
    private readonly normalizer: RadarNormalizerService,
  ) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /**
   * Classifies all PENDING ChannelMessages for an import.
   * Returns counters: { classified, skippedPrefilter, failed }
   */
  async classifyImportMessages(
    tenantId: string,
    importId: string,
  ): Promise<{ classified: number; skippedPrefilter: number; failed: number }> {
    const messages = await this.prisma.channelMessage.findMany({
      where: {
        importId,
        tenantId,
        classificationStatus: { in: [ClassificationStatus.PENDING, ClassificationStatus.FAILED] },
      },
      select: { id: true, content: true, senderRaw: true, postedAt: true },
    });

    let classified = 0;
    let skippedPrefilter = 0;
    let failed = 0;

    for (const msg of messages) {
      try {
        if (!passesPredicate(msg.content)) {
          await this.prisma.channelMessage.updateMany({
            where: { id: msg.id, tenantId },
            data: {
              classificationStatus: ClassificationStatus.SKIPPED_PREFILTER,
              processedAt: new Date(),
            },
          });
          skippedPrefilter++;
          continue;
        }

        const extraction = this.guardExplicitReference(
          msg.content,
          await this.callAi(msg.content),
        );
        await this.persistResult(tenantId, importId, msg.id, extraction);
        classified++;
      } catch (err) {
        this.logger.error(`Classification failed for message ${msg.id}: ${String(err)}`);
        await this.prisma.channelMessage.updateMany({
          where: { id: msg.id, tenantId },
          data: {
            classificationStatus: ClassificationStatus.FAILED,
            processedAt: new Date(),
          },
        });
        failed++;
      }
    }

    return { classified, skippedPrefilter, failed };
  }

  private async callAi(content: string): Promise<AiExtractionResult> {
    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    const text =
      response.content[0]?.type === 'text' ? response.content[0].text : '';

    let parsed: Record<string, unknown>;
    try {
      // Strip markdown code fences if present
      const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(clean) as Record<string, unknown>;
    } catch {
      throw new Error(`AI returned non-JSON response: ${text.slice(0, 200)}`);
    }

    return this.validateExtraction(parsed);
  }

  private validateExtraction(raw: Record<string, unknown>): AiExtractionResult {
    const VALID_INTENTS: AiIntent[] = [
      'SELL_OFFER', 'BUY_REQUEST', 'PRICE_SIGNAL', 'GENERAL_INQUIRY', 'IRRELEVANT',
    ];
    const intent = VALID_INTENTS.includes(raw['intent'] as AiIntent)
      ? (raw['intent'] as AiIntent)
      : 'IRRELEVANT';

    const confidence =
      typeof raw['confidence'] === 'number'
        ? Math.min(1, Math.max(0, raw['confidence']))
        : 0.5;

    return {
      intent,
      confidence,
      brand: typeof raw['brand'] === 'string' ? raw['brand'] : null,
      model: typeof raw['model'] === 'string' ? raw['model'] : null,
      referenceNumberExplicit:
        typeof raw['referenceNumberExplicit'] === 'string'
          ? raw['referenceNumberExplicit']
          : null,
      rawModelMention:
        typeof raw['rawModelMention'] === 'string' ? raw['rawModelMention'] : null,
      priceAmount:
        typeof raw['priceAmount'] === 'number' ? raw['priceAmount'] : null,
      priceCurrency:
        typeof raw['priceCurrency'] === 'string' ? raw['priceCurrency'] : null,
      urgencyDetected: raw['urgencyDetected'] === true,
      conditionNotes:
        typeof raw['conditionNotes'] === 'string' ? raw['conditionNotes'] : null,
      hasBox: typeof raw['hasBox'] === 'boolean' ? raw['hasBox'] : null,
      hasPapers: typeof raw['hasPapers'] === 'boolean' ? raw['hasPapers'] : null,
      year: typeof raw['year'] === 'number' ? Math.floor(raw['year']) : null,
      aiSummary:
        typeof raw['aiSummary'] === 'string' ? raw['aiSummary'].slice(0, 300) : '',
    };
  }

  private async persistResult(
    tenantId: string,
    importId: string,
    messageId: string,
    extraction: AiExtractionResult,
  ): Promise<void> {
    const now = new Date();

    // Mark message classified regardless of whether a listing is created
    await this.prisma.channelMessage.updateMany({
      where: { id: messageId, tenantId },
      data: { classificationStatus: ClassificationStatus.COMPLETED, processedAt: now },
    });

    // IRRELEVANT → no listing
    if (extraction.intent === 'IRRELEVANT') return;

    // Check for existing listing (idempotent re-runs)
    const existing = await this.prisma.marketListing.findUnique({
      where: { messageId },
    });
    if (existing) return;

    const { watchReferenceId, referenceSource } = await this.normalizer.normalize(extraction);

    const feedConfidence = this.computeFeedConfidence(extraction, !!watchReferenceId);

    const intent = extraction.intent as MarketListingIntent;

    const reviewStatus = ReviewStatus.PENDING_REVIEW;

    await this.prisma.marketListing.create({
      data: {
        tenant: { connect: { id: tenantId } },
        message: { connect: { id: messageId } },
        ...(watchReferenceId ? { watchReference: { connect: { id: watchReferenceId } } } : {}),
        intent,
        reviewStatus,
        referenceSource: referenceSource ?? undefined,
        brand: extraction.brand ?? undefined,
        initialConfidence: extraction.confidence,
        feedConfidence,
        rawModelMention: extraction.rawModelMention ?? undefined,
        referenceNumberExplicit: extraction.referenceNumberExplicit ?? undefined,
        aiSummary: extraction.aiSummary || undefined,
        urgencyDetected: extraction.urgencyDetected,
        conditionNotes: extraction.conditionNotes ?? undefined,
        hasBox: extraction.hasBox ?? undefined,
        hasPapers: extraction.hasPapers ?? undefined,
        year: extraction.year ?? undefined,
        priceAmount: extraction.priceAmount != null
          ? new Prisma.Decimal(extraction.priceAmount)
          : undefined,
        priceCurrency: extraction.priceCurrency ?? undefined,
        aiRawResponse: extraction as unknown as Prisma.InputJsonValue,
      },
    });

    // Increment listingsCreated on the import
    await this.prisma.radarImport.updateMany({
      where: { id: importId, tenantId },
      data: { listingsCreated: { increment: 1 } },
    });
  }

  // Anti-hallucination: explicit reference is only valid if it literally appears in the message.
  // Haiku may infer a reference from a model name (e.g. "Kermit" → "126610LV") and incorrectly
  // populate referenceNumberExplicit. This guard clears that field when the alleged reference
  // string is not present verbatim in the original content.
  private guardExplicitReference(
    content: string,
    extraction: AiExtractionResult,
  ): AiExtractionResult {
    if (!extraction.referenceNumberExplicit) return extraction;
    const bodyLower = content.toLowerCase();
    const refLower = extraction.referenceNumberExplicit.toLowerCase();
    if (!bodyLower.includes(refLower)) {
      return { ...extraction, referenceNumberExplicit: null };
    }
    return extraction;
  }

  private computeFeedConfidence(
    extraction: AiExtractionResult,
    hasWatchReference: boolean,
  ): number {
    let score = extraction.confidence;

    // Boost for confirmed catalog match
    if (hasWatchReference) score = Math.min(1, score + 0.1);

    // Boost for explicit reference number
    if (extraction.referenceNumberExplicit) score = Math.min(1, score + 0.05);

    // Boost for price signal on sell/buy intent
    if (
      extraction.priceAmount != null &&
      (extraction.intent === 'SELL_OFFER' || extraction.intent === 'BUY_REQUEST')
    ) {
      score = Math.min(1, score + 0.05);
    }

    // Slight penalty if no brand or model extracted
    if (!extraction.brand && !extraction.model && !extraction.rawModelMention) {
      score = Math.max(0, score - 0.15);
    }

    return Math.round(score * 1000) / 1000;
  }

  isHighConfidence(feedConfidence: number): boolean {
    return feedConfidence >= CONFIDENCE_HIGH;
  }
}
