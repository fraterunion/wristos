import { BadRequestException } from '@nestjs/common';
import { ClientRegistrationService } from './client-registration.service';
import { ClientUpdateService } from './client-update.service';
import { CrmService } from './crm.service';

describe('CrmService.updateClient interactive CAS', () => {
  it('requires expectedUpdatedAt on the HTTP/CRM path', async () => {
    const prisma = {
      client: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    } as never;
    const crm = new CrmService(
      prisma,
      new ClientRegistrationService(prisma),
      new ClientUpdateService(prisma),
    );

    await expect(
      crm.updateClient('c1', 't1', { phone: '+525511111111' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
