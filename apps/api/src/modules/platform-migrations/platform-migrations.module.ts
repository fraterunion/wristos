import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../core/auth/auth.module';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { WristCaviarMigrationController } from './wrist-caviar/controllers/wrist-caviar-migration.controller';
import { WristCaviarMigrationService } from './wrist-caviar/services/wrist-caviar-migration.service';
import { WristCaviarReviewService } from './wrist-caviar/services/wrist-caviar-review.service';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule],
  controllers: [WristCaviarMigrationController],
  providers: [WristCaviarMigrationService, WristCaviarReviewService, PlatformAdminGuard],
  exports: [WristCaviarMigrationService, WristCaviarReviewService],
})
export class PlatformMigrationsModule {}
