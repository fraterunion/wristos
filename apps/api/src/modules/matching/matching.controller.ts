import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { ListSuggestionsDto } from './dto/list-suggestions.dto';
import { RecalculateMatchingDto } from './dto/recalculate-matching.dto';
import { MatchingService } from './matching.service';

@Controller('matching')
@UseGuards(JwtAuthGuard)
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Post('recalculate')
  recalculate(@CurrentUser() user: CurrentUserType, @Body() dto: RecalculateMatchingDto) {
    return this.matchingService.recalculate(user.tenantId, dto);
  }

  @Get('clients/:clientId/suggestions')
  listForClient(
    @Param('clientId') clientId: string,
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListSuggestionsDto,
  ) {
    return this.matchingService.listForClient(
      clientId,
      user.tenantId,
      query.includeDismissed ?? false,
    );
  }

  @Get('watches/:watchId/suggestions')
  listForWatch(
    @Param('watchId') watchId: string,
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListSuggestionsDto,
  ) {
    return this.matchingService.listForWatch(
      watchId,
      user.tenantId,
      query.includeDismissed ?? false,
    );
  }

  @Patch('suggestions/:id/dismiss')
  dismiss(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.matchingService.dismissSuggestion(id, user.tenantId);
  }
}
