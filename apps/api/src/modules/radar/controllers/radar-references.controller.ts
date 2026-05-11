import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../core/auth/guards/jwt-auth.guard';
import { SearchReferencesDto } from '../dto/search-references.dto';
import { RadarReferencesService } from '../services/radar-references.service';

@Controller('radar')
@UseGuards(JwtAuthGuard)
export class RadarReferencesController {
  constructor(private readonly referencesService: RadarReferencesService) {}

  @Get('references')
  search(@Query() query: SearchReferencesDto) {
    const limit = Math.min(query.limit ?? 20, 50);
    return this.referencesService.search(query.q, query.brand, limit);
  }
}
