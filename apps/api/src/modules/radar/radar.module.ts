import { Module } from '@nestjs/common';
import { RadarContactsController } from './controllers/radar-contacts.controller';
import { RadarImportsController } from './controllers/radar-imports.controller';
import { RadarListingsController } from './controllers/radar-listings.controller';
import { RadarReferencesController } from './controllers/radar-references.controller';
import { RadarClassifierService } from './services/radar-classifier.service';
import { RadarContactsService } from './services/radar-contacts.service';
import { RadarImportsService } from './services/radar-imports.service';
import { RadarListingsService } from './services/radar-listings.service';
import { RadarNormalizerService } from './services/radar-normalizer.service';
import { RadarParserService } from './services/radar-parser.service';
import { RadarReferencesService } from './services/radar-references.service';

@Module({
  controllers: [
    RadarImportsController,
    RadarListingsController,
    RadarContactsController,
    RadarReferencesController,
  ],
  providers: [
    RadarImportsService,
    RadarParserService,
    RadarContactsService,
    RadarClassifierService,
    RadarNormalizerService,
    RadarReferencesService,
    RadarListingsService,
  ],
})
export class RadarModule {}
