import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../platform-migrations/guards/platform-admin.guard';
import { DemoResetService } from './demo-reset.service';

@Controller('platform/demo')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class DemoResetController {
  constructor(private readonly demoResetService: DemoResetService) {}

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset() {
    return this.demoResetService.resetDemoTenant();
  }
}
