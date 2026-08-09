import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { CuentasController } from './cuentas.controller';
import { CuentasService } from './cuentas.service';
import { ManualAccountEntryService } from './manual-account-entry.service';
import { PayablePaymentService } from './payable-payment.service';
import { ReceivablePaymentService } from './receivable-payment.service';

@Module({
  imports: [FxModule, TreasuryModule],
  controllers: [CuentasController],
  providers: [
    CuentasService,
    ManualAccountEntryService,
    ReceivablePaymentService,
    PayablePaymentService,
  ],
  exports: [
    CuentasService,
    ManualAccountEntryService,
    ReceivablePaymentService,
    PayablePaymentService,
  ],
})
export class CuentasModule {}
