import { Body, Controller, Param, Post } from '@nestjs/common';
import { CreateReservationCheckoutDto } from './dto/create-reservation-checkout.dto';
import { StorefrontService } from './storefront.service';

@Controller('public/:tenantSlug/checkout')
export class StorefrontCheckoutController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Post('reserve')
  reserve(
    @Param('tenantSlug') tenantSlug: string,
    @Body() dto: CreateReservationCheckoutDto,
  ) {
    return this.storefrontService.createReservationCheckout(tenantSlug, dto);
  }
}
