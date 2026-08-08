import { Module } from '@nestjs/common';
import { ClientRegistrationService } from './client-registration.service';
import { ClientUpdateService } from './client-update.service';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  controllers: [CrmController],
  providers: [CrmService, ClientRegistrationService, ClientUpdateService],
  exports: [CrmService, ClientRegistrationService, ClientUpdateService],
})
export class CrmModule {}
