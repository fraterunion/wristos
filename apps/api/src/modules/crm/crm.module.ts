import { Module } from '@nestjs/common';
import { ClientRegistrationService } from './client-registration.service';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  controllers: [CrmController],
  providers: [CrmService, ClientRegistrationService],
  exports: [CrmService, ClientRegistrationService],
})
export class CrmModule {}
