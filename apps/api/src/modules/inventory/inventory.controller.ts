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
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { CreateWatchDto } from './dto/create-watch.dto';
import { ListWatchesDto } from './dto/list-watches.dto';
import { UpdateWatchDto } from './dto/update-watch.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateWatchDto) {
    return this.inventoryService.create(user.tenantId, dto);
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType, @Query() query: ListWatchesDto) {
    return this.inventoryService.list(user.tenantId, query);
  }

  @Get('upload-signature')
  getUploadSignature(@CurrentUser() user: CurrentUserType) {
    return this.inventoryService.generateUploadSignature(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.inventoryService.findOne(id, user.tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateWatchDto,
  ) {
    return this.inventoryService.update(id, user.tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.inventoryService.remove(id, user.tenantId);
  }

  @Post(':id/expenses')
  addExpense(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.inventoryService.addExpense(id, user.tenantId, dto);
  }

  @Delete(':id/expenses/:expenseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeExpense(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Param('expenseId') expenseId: string,
  ) {
    return this.inventoryService.removeExpense(id, expenseId, user.tenantId);
  }
}
