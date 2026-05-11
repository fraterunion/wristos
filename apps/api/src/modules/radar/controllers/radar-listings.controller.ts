import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../../common/types/current-user.type';
import { JwtAuthGuard } from '../../core/auth/guards/jwt-auth.guard';
import { ConfirmListingDto, DismissListingDto } from '../dto/confirm-listing.dto';
import { SearchListingsDto } from '../dto/search-listings.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';
import { RadarListingsService } from '../services/radar-listings.service';

@Controller('radar')
@UseGuards(JwtAuthGuard)
export class RadarListingsController {
  constructor(private readonly listingsService: RadarListingsService) {}

  @Get('listings')
  findAll(@CurrentUser() user: CurrentUserType, @Query() query: SearchListingsDto) {
    return this.listingsService.findAll(user.tenantId, query);
  }

  @Get('listings/review')
  findReviewQueue(
    @CurrentUser() user: CurrentUserType,
    @Query('page') rawPage?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const page = Math.max(1, parseInt(rawPage ?? '1', 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(rawLimit ?? '10', 10) || 10), 100);
    return this.listingsService.findReviewQueue(user.tenantId, page, limit);
  }

  @Get('listings/:id')
  findOne(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.listingsService.findOne(user.tenantId, id);
  }

  @Patch('listings/:id')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() body: UpdateListingDto,
  ) {
    return this.listingsService.update(user.tenantId, id, body);
  }

  @Post('listings/:id/confirm')
  confirm(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() body: ConfirmListingDto,
  ) {
    return this.listingsService.confirm(user.tenantId, id, user.userId, body);
  }

  @Post('listings/:id/dismiss')
  dismiss(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() body: DismissListingDto,
  ) {
    return this.listingsService.dismiss(user.tenantId, id, user.userId, body);
  }
}
