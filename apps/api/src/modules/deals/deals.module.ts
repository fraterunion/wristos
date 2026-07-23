import { Module } from '@nestjs/common';
import { CuentasModule } from '../cuentas/cuentas.module';
import { FxModule } from '../fx/fx.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReceivablesModule } from '../receivables/receivables.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';

@Module({
  imports: [PaymentsModule, FxModule, CuentasModule, ReceivablesModule],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
