import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../core/auth/auth.module';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { WristCaviarDryRunController } from './wrist-caviar/controllers/wrist-caviar-dry-run.controller';
import { WristCaviarMigrationController } from './wrist-caviar/controllers/wrist-caviar-migration.controller';
import { WristCaviarDryRunService } from './wrist-caviar/services/wrist-caviar-dry-run.service';
import { WristCaviarMigrationService } from './wrist-caviar/services/wrist-caviar-migration.service';
import { WristCaviarReviewService } from './wrist-caviar/services/wrist-caviar-review.service';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule],
  controllers: [WristCaviarDryRunController, WristCaviarMigrationController],
  providers: [
    WristCaviarMigrationService,
    WristCaviarReviewService,
    WristCaviarDryRunService,
    PlatformAdminGuard,
  ],
  exports: [WristCaviarMigrationService, WristCaviarReviewService, WristCaviarDryRunService],
})
export class PlatformMigrationsModule {}
