import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { CuentasController } from './cuentas.controller';
import { CuentasService } from './cuentas.service';
import { ReceivablePaymentService } from './receivable-payment.service';

@Module({
  imports: [FxModule, TreasuryModule],
  controllers: [CuentasController],
  providers: [CuentasService, ReceivablePaymentService],
  exports: [CuentasService, ReceivablePaymentService],
})
export class CuentasModule {}
