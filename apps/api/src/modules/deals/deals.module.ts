import { Module } from '@nestjs/common';
import { CuentasModule } from '../cuentas/cuentas.module';
import { FxModule } from '../fx/fx.module';
import { PaymentsModule } from '../payments/payments.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { SaleRegistrationService } from './sale-registration.service';

@Module({
  imports: [PaymentsModule, FxModule, CuentasModule, TreasuryModule],
  controllers: [DealsController],
  providers: [DealsService, SaleRegistrationService],
  exports: [DealsService, SaleRegistrationService],
})
export class DealsModule {}
