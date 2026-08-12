import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../core/auth/auth.module';
import { PlatformAdminGuard } from '../platform-migrations/guards/platform-admin.guard';
import { DemoResetController } from './demo-reset.controller';
import { DemoResetService } from './demo-reset.service';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [DemoResetController],
  providers: [DemoResetService, PlatformAdminGuard],
})
export class PlatformDemoModule {}
