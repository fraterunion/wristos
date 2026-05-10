import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../../common/types/current-user.type';
import { JwtAuthGuard } from '../../core/auth/guards/jwt-auth.guard';
import { MulterFile, RadarImportsService } from '../services/radar-imports.service';

@Controller('radar')
@UseGuards(JwtAuthGuard)
export class RadarImportsController {
  constructor(private readonly importsService: RadarImportsService) {}

  @Post('imports')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  createImport(
    @CurrentUser() user: CurrentUserType,
    @UploadedFile() file: MulterFile,
  ) {
    return this.importsService.createImport(user.tenantId, file);
  }

  @Get('imports/:id')
  getImport(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.importsService.getImport(user.tenantId, id);
  }

  @Post('imports/:id/classify')
  classifyImport(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.importsService.classifyImport(user.tenantId, id);
  }
}
