import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { AutomationsService } from './automations.service';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';

@Controller('automations')
@UseGuards(JwtAuthGuard)
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Post('rules')
  createRule(@CurrentUser() user: CurrentUserType, @Body() dto: CreateAutomationRuleDto) {
    return this.automationsService.createRule(user.tenantId, dto);
  }

  @Get('rules')
  listRules(@CurrentUser() user: CurrentUserType) {
    return this.automationsService.listRules(user.tenantId);
  }

  @Patch('rules/:id')
  updateRule(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateAutomationRuleDto,
  ) {
    return this.automationsService.updateRule(id, user.tenantId, dto);
  }

  @Post('run')
  run(@CurrentUser() user: CurrentUserType) {
    return this.automationsService.run(user.tenantId);
  }
}
