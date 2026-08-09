import { Module } from '@nestjs/common';
import { TreasuryController } from './treasury.controller';
import { TreasuryTransferService } from './treasury-transfer.service';
import { TreasuryService } from './treasury.service';

@Module({
  controllers: [TreasuryController],
  providers: [TreasuryService, TreasuryTransferService],
  exports: [TreasuryService, TreasuryTransferService],
})
export class TreasuryModule {}
