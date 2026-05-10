import { Injectable } from '@nestjs/common';
import { ExtractionSource } from '@prisma/client';
import { AiExtractionResult } from '../types/ai-extraction.type';
import { RadarReferencesService, WatchReferenceRow } from './radar-references.service';

export interface NormalizationResult {
  watchReferenceId: string | null;
  referenceSource: ExtractionSource | null;
}

@Injectable()
export class RadarNormalizerService {
  constructor(private readonly references: RadarReferencesService) {}

  async normalize(extraction: AiExtractionResult): Promise<NormalizationResult> {
    const catalog = await this.references.getAll();

    // 1. Explicit reference number match (sender literally wrote a ref)
    if (extraction.referenceNumberExplicit) {
      const refUpper = extraction.referenceNumberExplicit.toUpperCase();
      const match = catalog.find(
        (r) => r.reference.toUpperCase() === refUpper,
      );
      if (match) {
        return { watchReferenceId: match.id, referenceSource: ExtractionSource.EXPLICIT };
      }
    }

    // 2. Alias match on rawModelMention
    if (extraction.rawModelMention) {
      const mentionLower = extraction.rawModelMention.toLowerCase().trim();
      const aliasMatch = this.findByAlias(catalog, mentionLower);
      if (aliasMatch) {
        return { watchReferenceId: aliasMatch.id, referenceSource: ExtractionSource.INFERRED };
      }
    }

    // 3. Brand + model substring match
    if (extraction.brand && extraction.model) {
      const brandLower = extraction.brand.toLowerCase();
      const modelLower = extraction.model.toLowerCase();
      const match = catalog.find(
        (r) =>
          r.brand.toLowerCase() === brandLower &&
          r.model.toLowerCase().includes(modelLower),
      );
      if (match) {
        return { watchReferenceId: match.id, referenceSource: ExtractionSource.INFERRED };
      }
    }

    return { watchReferenceId: null, referenceSource: null };
  }

  private findByAlias(catalog: WatchReferenceRow[], term: string): WatchReferenceRow | null {
    for (const row of catalog) {
      for (const alias of row.aliases) {
        if (alias.toLowerCase() === term) return row;
      }
      // Also check model name directly
      if (row.model.toLowerCase() === term) return row;
      if (row.reference.toLowerCase() === term) return row;
    }
    return null;
  }
}
