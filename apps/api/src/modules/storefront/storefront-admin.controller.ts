import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { ListStorefrontReservationsDto } from './dto/list-storefront-reservations.dto';
import { StorefrontAdminService } from './storefront-admin.service';

@Controller('storefront')
@UseGuards(JwtAuthGuard)
export class StorefrontAdminController {
  constructor(private readonly storefrontAdminService: StorefrontAdminService) {}

  @Get('reservations')
  listReservations(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListStorefrontReservationsDto,
  ) {
    return this.storefrontAdminService.listReservations(user.tenantId, query);
  }

  @Get('reservations/:id')
  findReservation(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.storefrontAdminService.findReservation(id, user.tenantId);
  }
}
