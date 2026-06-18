import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { StorefrontAdminController } from './storefront-admin.controller';
import { StorefrontAdminService } from './storefront-admin.service';
import { StorefrontCheckoutController } from './storefront-checkout.controller';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

@Module({
  imports: [StripeModule],
  controllers: [
    StorefrontController,
    StorefrontCheckoutController,
    StorefrontAdminController,
  ],
  providers: [StorefrontService, StorefrontAdminService],
})
export class StorefrontModule {}
