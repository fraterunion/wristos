import { Module } from '@nestjs/common';

import { FxModule } from '../fx/fx.module';
import { ReceivablesModule } from '../receivables/receivables.module';
import { DataOnboardingController } from './data-onboarding.controller';
import { DataOnboardingService } from './data-onboarding.service';
import { WatchImportService } from './inventory-import/watch-import.service';
import { PdfInvoiceImportService } from './pdf-invoice-import.service';
import { PdfSalesImportService } from './pdf-sales-import.service';
import { SalesImportService } from './sales-import/sales-import.service';
import { createImportFileStorage } from './storage/import-file-storage.factory';
import { IMPORT_FILE_STORAGE } from './tokens';
export { IMPORT_FILE_STORAGE } from './tokens';

@Module({
  imports: [FxModule, ReceivablesModule],
  controllers: [DataOnboardingController],
  providers: [
    { provide: IMPORT_FILE_STORAGE, useValue: createImportFileStorage() },
    DataOnboardingService,
    WatchImportService,
    SalesImportService,
    PdfInvoiceImportService,
    PdfSalesImportService,
  ],
})
export class DataOnboardingModule {}
