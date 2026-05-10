import { Module } from '@nestjs/common';
import { RadarImportsController } from './controllers/radar-imports.controller';
import { RadarContactsService } from './services/radar-contacts.service';
import { RadarImportsService } from './services/radar-imports.service';
import { RadarParserService } from './services/radar-parser.service';

@Module({
  controllers: [RadarImportsController],
  providers: [RadarImportsService, RadarParserService, RadarContactsService],
})
export class RadarModule {}
