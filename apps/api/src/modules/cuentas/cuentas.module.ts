import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { CuentasController } from './cuentas.controller';
import { CuentasService } from './cuentas.service';
import { PayablePaymentService } from './payable-payment.service';
import { ReceivablePaymentService } from './receivable-payment.service';

@Module({
  imports: [FxModule, TreasuryModule],
  controllers: [CuentasController],
  providers: [CuentasService, ReceivablePaymentService, PayablePaymentService],
  exports: [CuentasService, ReceivablePaymentService, PayablePaymentService],
})
export class CuentasModule {}
