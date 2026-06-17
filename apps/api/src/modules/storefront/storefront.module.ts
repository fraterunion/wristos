import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { StorefrontCheckoutController } from './storefront-checkout.controller';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

@Module({
  imports: [StripeModule],
  controllers: [StorefrontController, StorefrontCheckoutController],
  providers: [StorefrontService],
})
export class StorefrontModule {}
