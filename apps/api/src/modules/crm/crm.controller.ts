import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { CrmService } from './crm.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateClientInteractionDto } from './dto/create-client-interaction.dto';
import { ListClientInteractionsDto } from './dto/list-client-interactions.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { TenantIdQueryDto } from './dto/tenant-id-query.dto';
import { UpsertClientPreferenceDto } from './dto/upsert-client-preference.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Controller('crm')
@UseGuards(JwtAuthGuard)
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Post('clients')
  createClient(@CurrentUser() user: CurrentUserType, @Body() dto: CreateClientDto) {
    return this.crmService.createClient(user.tenantId, dto);
  }

  @Get('clients')
  listClients(@CurrentUser() user: CurrentUserType, @Query() query: ListClientsDto) {
    return this.crmService.listClients(user.tenantId, query);
  }

  @Get('clients/:id')
  getClient(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.crmService.getClientById(id, user.tenantId);
  }

  @Patch('clients/:id')
  updateClient(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateClientDto,
  ) {
    return this.crmService.updateClient(id, user.tenantId, dto);
  }

  @Delete('clients/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteClient(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.crmService.deleteClient(id, user.tenantId);
  }

  @Post('clients/:id/interactions')
  createInteraction(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateClientInteractionDto,
  ) {
    return this.crmService.createInteraction(id, user.tenantId, dto);
  }

  @Get('clients/:id/interactions')
  listInteractions(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListClientInteractionsDto,
  ) {
    return this.crmService.listInteractions(id, user.tenantId, query);
  }

  @Get('clients/:id/preference')
  getPreference(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.crmService.getClientPreference(id, user.tenantId);
  }

  @Put('clients/:id/preference')
  upsertPreference(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpsertClientPreferenceDto,
  ) {
    return this.crmService.upsertClientPreference(id, user.tenantId, dto);
  }
}
