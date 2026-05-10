import { Module } from '@nestjs/common';
import { RadarImportsController } from './controllers/radar-imports.controller';
import { RadarClassifierService } from './services/radar-classifier.service';
import { RadarContactsService } from './services/radar-contacts.service';
import { RadarImportsService } from './services/radar-imports.service';
import { RadarNormalizerService } from './services/radar-normalizer.service';
import { RadarParserService } from './services/radar-parser.service';
import { RadarReferencesService } from './services/radar-references.service';

@Module({
  controllers: [RadarImportsController],
  providers: [
    RadarImportsService,
    RadarParserService,
    RadarContactsService,
    RadarClassifierService,
    RadarNormalizerService,
    RadarReferencesService,
  ],
})
export class RadarModule {}
