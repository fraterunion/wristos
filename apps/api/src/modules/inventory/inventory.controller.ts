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
import { CreateWatchImageDto } from './dto/create-watch-image.dto';
import { ListWatchesDto } from './dto/list-watches.dto';
import { UpdateWatchDto } from './dto/update-watch.dto';
import { UpdateWatchImageDto } from './dto/update-watch-image.dto';
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

  @Get(':watchId/images')
  listWatchImages(
    @CurrentUser() user: CurrentUserType,
    @Param('watchId') watchId: string,
  ) {
    return this.inventoryService.listWatchImages(watchId, user.tenantId);
  }

  @Post(':watchId/images')
  createWatchImage(
    @CurrentUser() user: CurrentUserType,
    @Param('watchId') watchId: string,
    @Body() dto: CreateWatchImageDto,
  ) {
    return this.inventoryService.createWatchImage(watchId, user.tenantId, dto);
  }

  @Patch(':watchId/images/:imageId')
  updateWatchImage(
    @CurrentUser() user: CurrentUserType,
    @Param('watchId') watchId: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateWatchImageDto,
  ) {
    return this.inventoryService.updateWatchImage(
      watchId,
      imageId,
      user.tenantId,
      dto,
    );
  }

  @Delete(':watchId/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeWatchImage(
    @CurrentUser() user: CurrentUserType,
    @Param('watchId') watchId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.inventoryService.removeWatchImage(watchId, imageId, user.tenantId);
  }

  @Post(':watchId/images/:imageId/set-primary')
  setPrimaryWatchImage(
    @CurrentUser() user: CurrentUserType,
    @Param('watchId') watchId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.inventoryService.setPrimaryWatchImage(
      watchId,
      imageId,
      user.tenantId,
    );
  }
}
