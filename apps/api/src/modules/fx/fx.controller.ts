import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { FxService } from './fx.service';

@Controller('fx')
@UseGuards(JwtAuthGuard)
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('usd-mxn')
  getUsdMxn() {
    return this.fxService.getUsdMxn();
  }
}
