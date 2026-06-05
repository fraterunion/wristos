import { Module } from '@nestjs/common';
import { CuentasController } from './cuentas.controller';
import { CuentasService } from './cuentas.service';

@Module({
  controllers: [CuentasController],
  providers: [CuentasService],
  exports: [CuentasService],
})
export class CuentasModule {}
