import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../../common/types/current-user.type';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SwitchTenantDto } from './dto/switch-tenant.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @Post('logout')
  logout() {
    return this.authService.logout();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: CurrentUserType) {
    return {
      userId: user.userId,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      isDemo: user.isDemo,
    };
  }

  @Post('switch-tenant')
  @UseGuards(JwtAuthGuard)
  switchTenant(@CurrentUser() user: CurrentUserType, @Body() dto: SwitchTenantDto) {
    return this.authService.switchTenant(user.userId, dto.tenantId);
  }

  @Get('tenants')
  @UseGuards(JwtAuthGuard)
  listMyTenants(@CurrentUser() user: CurrentUserType) {
    return this.authService.listMyTenants(user.userId);
  }
}
