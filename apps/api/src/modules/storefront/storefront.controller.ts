import { Controller, Get, Param } from '@nestjs/common';
import { StorefrontService } from './storefront.service';

@Controller('public/:tenantSlug/watches')
export class StorefrontController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Get()
  list(@Param('tenantSlug') tenantSlug: string) {
    return this.storefrontService.listPublishedWatches(tenantSlug);
  }

  @Get(':slug')
  detail(@Param('tenantSlug') tenantSlug: string, @Param('slug') slug: string) {
    return this.storefrontService.getPublishedWatch(tenantSlug, slug);
  }
}
