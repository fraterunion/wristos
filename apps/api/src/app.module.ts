import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app.controller';
import { AuthModule } from './modules/core/auth/auth.module';
import { UsersModule } from './modules/core/users/users.module';
import { TenantsModule } from './modules/core/tenants/tenants.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CrmModule } from './modules/crm/crm.module';
import { DealsModule } from './modules/deals/deals.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MatchingModule } from './modules/matching/matching.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { HistoryModule } from './modules/history/history.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { RadarModule } from './modules/radar/radar.module';
import { FxModule } from './modules/fx/fx.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    InventoryModule,
    CrmModule,
    DealsModule,
    PaymentsModule,
    AnalyticsModule,
    MatchingModule,
    AutomationsModule,
    HistoryModule,
    ExpensesModule,
    RadarModule,
    FxModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
