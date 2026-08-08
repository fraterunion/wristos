import { Module } from '@nestjs/common';
import { TreasuryModule } from '../treasury/treasury.module';
import { ExpenseRegistrationService } from './expense-registration.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [TreasuryModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseRegistrationService],
  exports: [ExpensesService, ExpenseRegistrationService],
})
export class ExpensesModule {}
