import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { HistoryService } from './history.service';

@Controller('history')
@UseGuards(JwtAuthGuard)
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserType) {
    return this.historyService.getSummary(user.tenantId);
  }

  @Get('sold')
  sold(@CurrentUser() user: CurrentUserType) {
    return this.historyService.getSold(user.tenantId);
  }

  @Get('stock')
  stock(@CurrentUser() user: CurrentUserType) {
    return this.historyService.getStock(user.tenantId);
  }

  @Get('acquired')
  acquired(@CurrentUser() user: CurrentUserType) {
    return this.historyService.getAcquired(user.tenantId);
  }

  @Get('movements')
  movements(@CurrentUser() user: CurrentUserType) {
    return this.historyService.getMovements(user.tenantId);
  }
}
