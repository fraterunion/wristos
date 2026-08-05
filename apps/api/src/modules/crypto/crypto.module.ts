import { Module } from '@nestjs/common';
import { CryptoController } from './crypto.controller';
import { CryptoService } from './crypto.service';

@Module({
  controllers: [CryptoController],
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
