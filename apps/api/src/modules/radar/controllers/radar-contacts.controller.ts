import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../../common/types/current-user.type';
import { JwtAuthGuard } from '../../core/auth/guards/jwt-auth.guard';
import { RadarListingsService } from '../services/radar-listings.service';

@Controller('radar')
@UseGuards(JwtAuthGuard)
export class RadarContactsController {
  constructor(private readonly listingsService: RadarListingsService) {}

  @Get('contacts/:id')
  getContactProfile(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.listingsService.getContactProfile(user.tenantId, id);
  }
}
