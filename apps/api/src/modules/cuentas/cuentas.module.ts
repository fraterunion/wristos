import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { CuentasController } from './cuentas.controller';
import { CuentasService } from './cuentas.service';

@Module({
  imports: [FxModule],
  controllers: [CuentasController],
  providers: [CuentasService],
  exports: [CuentasService],
})
export class CuentasModule {}
