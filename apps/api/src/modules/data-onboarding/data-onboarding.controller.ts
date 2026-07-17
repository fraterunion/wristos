import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { DataOnboardingService } from './data-onboarding.service';
import { CreateDataImportSessionDto, ListDataImportRecordsQueryDto } from './dto/data-onboarding.dto';
import type { MulterFile } from './types/multer-file.type';
import { maxImportFileSizeBytes } from './utils/file-validation.util';

@Controller('data-onboarding')
@UseGuards(JwtAuthGuard)
export class DataOnboardingController {
  constructor(private readonly dataOnboardingService: DataOnboardingService) {}

  @Post('sessions')
  createSession(@CurrentUser() user: CurrentUserType, @Body() dto: CreateDataImportSessionDto) {
    return this.dataOnboardingService.createSession(user.tenantId, user.userId, dto);
  }

  @Get('sessions')
  listSessions(@CurrentUser() user: CurrentUserType) {
    return this.dataOnboardingService.listSessions(user.tenantId);
  }

  @Get('sessions/:sessionId')
  getSession(@CurrentUser() user: CurrentUserType, @Param('sessionId') sessionId: string) {
    return this.dataOnboardingService.getSession(user.tenantId, sessionId);
  }

  @Get('sessions/:sessionId/files')
  listFiles(@CurrentUser() user: CurrentUserType, @Param('sessionId') sessionId: string) {
    return this.dataOnboardingService.listFiles(user.tenantId, sessionId);
  }

  @Post('sessions/:sessionId/files')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: maxImportFileSizeBytes() },
    }),
  )
  uploadFile(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @UploadedFile() file: MulterFile,
  ) {
    return this.dataOnboardingService.uploadFile(user.tenantId, sessionId, file);
  }

  @Get('sessions/:sessionId/records')
  listRecords(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Query() query: ListDataImportRecordsQueryDto,
  ) {
    return this.dataOnboardingService.listRecords(user.tenantId, sessionId, query);
  }

  @Post('sessions/:sessionId/process')
  processSession(@CurrentUser() user: CurrentUserType, @Param('sessionId') sessionId: string) {
    return this.dataOnboardingService.processSession(user.tenantId, sessionId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSession(@CurrentUser() user: CurrentUserType, @Param('sessionId') sessionId: string) {
    return this.dataOnboardingService.deleteSession(user.tenantId, sessionId);
  }
}
