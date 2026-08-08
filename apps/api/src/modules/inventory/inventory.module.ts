import { Module } from '@nestjs/common';
import { CuentasModule } from '../cuentas/cuentas.module';
import { FxModule } from '../fx/fx.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { PurchaseRegistrationService } from './purchase-registration.service';

@Module({
  imports: [FxModule, TreasuryModule, CuentasModule],
  controllers: [InventoryController],
  providers: [InventoryService, PurchaseRegistrationService],
  exports: [InventoryService, PurchaseRegistrationService],
})
export class InventoryModule {}
