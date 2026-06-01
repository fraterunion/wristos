import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ChannelType, ClassificationStatus, ImportStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ImportSummary } from '../types/import-summary.type';
import { computeContentHash } from '../utils/content-hash.util';
import { RadarClassifierService } from './radar-classifier.service';
import { RadarContactsService } from './radar-contacts.service';
import { RadarParserService } from './radar-parser.service';

// Sentinel externalChannelId that ensures one WHATSAPP export channel per tenant
// via the @@unique([tenantId, externalChannelId]) constraint on Channel.
const EXPORT_CHANNEL_SENTINEL = 'whatsapp-txt-export';

export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class RadarImportsService {
  private readonly logger = new Logger(RadarImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: RadarParserService,
    private readonly contacts: RadarContactsService,
    private readonly classifier: RadarClassifierService,
  ) {}

  async createImport(tenantId: string, file: MulterFile): Promise<ImportSummary> {
    this.validateFile(file);

    const channel = await this.ensureExportChannel(tenantId);

    const radarImport = await this.prisma.radarImport.create({
      data: {
        tenant: { connect: { id: tenantId } },
        channel: { connect: { id: channel.id } },
        status: ImportStatus.PARSING,
        startedAt: new Date(),
        originalFileName: file.originalname,
        fileSizeBytes: file.size,
      },
    });

    try {
      return await this.processImport(tenantId, channel.id, radarImport.id, file);
    } catch (error) {
      await this.prisma.radarImport.updateMany({
        where: { id: radarImport.id, tenantId },
        data: {
          status: ImportStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : 'Unexpected error during import',
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async classifyImport(tenantId: string, importId: string): Promise<ImportSummary> {
    const imp = await this.prisma.radarImport.findFirst({
      where: { id: importId, tenantId },
    });

    if (!imp) throw new NotFoundException('Import not found');

    const hasPending = await this.prisma.channelMessage.findFirst({
      where: {
        importId,
        tenantId,
        classificationStatus: { in: [ClassificationStatus.PENDING, ClassificationStatus.FAILED] },
      },
    });

    if (!hasPending) {
      // Nothing to classify — return current summary
      return this.getImport(tenantId, importId);
    }

    await this.prisma.radarImport.updateMany({
      where: { id: importId, tenantId },
      data: { status: ImportStatus.CLASSIFYING },
    });

    try {
      const { classified, skippedPrefilter, failed } =
        await this.classifier.classifyImportMessages(tenantId, importId);

      const newStatus = failed > 0 ? ImportStatus.PARTIAL : ImportStatus.COMPLETED;

      const existing = await this.prisma.radarImport.findFirst({
        where: { id: importId, tenantId },
        select: { stats: true, listingsCreated: true },
      });

      const existingStats = (existing?.stats as Record<string, number> | null) ?? {};

      await this.prisma.radarImport.updateMany({
        where: { id: importId, tenantId },
        data: {
          status: newStatus,
          completedAt: new Date(),
          stats: {
            ...existingStats,
            classified,
            skippedPrefilter,
            classificationFailed: failed,
          },
        },
      });

      return this.getImport(tenantId, importId);
    } catch (error) {
      await this.prisma.radarImport.updateMany({
        where: { id: importId, tenantId },
        data: {
          status: ImportStatus.FAILED,
          errorMessage:
            error instanceof Error ? error.message : 'Unexpected error during classification',
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async getImport(tenantId: string, importId: string): Promise<ImportSummary> {
    const imp = await this.prisma.radarImport.findFirst({
      where: { id: importId, tenantId },
    });

    if (!imp) {
      throw new NotFoundException('Import not found');
    }

    const stats = (imp.stats as Record<string, number> | null) ?? {};

    return {
      importId: imp.id,
      status: imp.status,
      sourceGroupName: imp.sourceGroupName,
      dateRangeStart: imp.dateRangeStart,
      dateRangeEnd: imp.dateRangeEnd,
      totalMessagesParsed: stats['totalParsed'] ?? 0,
      validMessagesStored: stats['pending'] ?? 0,
      duplicatesSkipped: stats['duplicates'] ?? 0,
      systemMessagesSkipped: stats['system'] ?? 0,
      mediaMessagesSkipped: stats['media'] ?? 0,
      parseErrors: stats['parseErrors'] ?? 0,
      uniqueSenders: stats['uniqueSenders'] ?? 0,
      listingsCreated: imp.listingsCreated,
      classified: stats['classified'] ?? 0,
      skippedPrefilter: stats['skippedPrefilter'] ?? 0,
      classificationFailed: stats['classificationFailed'] ?? 0,
    };
  }

  private async processImport(
    tenantId: string,
    channelId: string,
    importId: string,
    file: MulterFile,
  ): Promise<ImportSummary> {
    const { messages, sourceGroupName, parseErrors } = this.parser.parse(
      file.buffer,
      file.originalname,
    );

    const pendingMessages = messages.filter((m) => !m.isSystemMessage && !m.hasMedia);
    const systemMessages = messages.filter((m) => m.isSystemMessage);
    const mediaMessages = messages.filter((m) => !m.isSystemMessage && m.hasMedia);

    const now = new Date();

    const buildRow = (msg: (typeof messages)[number]) => ({
      tenantId,
      channelId,
      importId,
      senderRaw: msg.senderRaw,
      content: msg.content,
      contentHash: computeContentHash(tenantId, msg.senderRaw, msg.timestamp, msg.content),
      postedAt: msg.timestamp,
      hasMedia: msg.hasMedia,
      isSystemMessage: msg.isSystemMessage,
      classificationStatus: msg.isSystemMessage
        ? ClassificationStatus.SKIPPED_SYSTEM
        : msg.hasMedia
          ? ClassificationStatus.SKIPPED_MEDIA
          : ClassificationStatus.PENDING,
      createdAt: now,
    });

    // Three separate createMany calls to get accurate per-category counts
    // DEBUG: bucket sizes before DB insert
    this.logger.log(
      `[DBG-IMPORT] importId=${importId} ` +
      `parsed=${messages.length} pending=${pendingMessages.length} ` +
      `system=${systemMessages.length} media=${mediaMessages.length}`,
    );

    // DEBUG: sample first 3 pending hashes + timestamp ISO strings to detect collisions/invalid dates
    for (const msg of pendingMessages.slice(0, 3)) {
      const hash = computeContentHash(tenantId, msg.senderRaw, msg.timestamp, msg.content);
      this.logger.log(
        `[DBG-IMPORT] sample-pending sender="${msg.senderRaw}" ` +
        `ts="${msg.timestamp.toISOString()}" ` +
        `hash=${hash.slice(0, 16)} ` +
        `content="${msg.content.slice(0, 60).replace(/\n/g, '↵')}"`,
      );
    }

    const [pendingResult, systemResult, mediaResult] = await Promise.all([
      this.prisma.channelMessage.createMany({
        data: pendingMessages.map(buildRow),
        skipDuplicates: true,
      }),
      this.prisma.channelMessage.createMany({
        data: systemMessages.map(buildRow),
        skipDuplicates: true,
      }),
      this.prisma.channelMessage.createMany({
        data: mediaMessages.map(buildRow),
        skipDuplicates: true,
      }),
    ]);

    // DEBUG: DB insert results — count=0 with candidates>0 means all were duplicates
    this.logger.log(
      `[DBG-IMPORT] createMany results importId=${importId} ` +
      `pendingInserted=${pendingResult.count}/${pendingMessages.length} ` +
      `systemInserted=${systemResult.count}/${systemMessages.length} ` +
      `mediaInserted=${mediaResult.count}/${mediaMessages.length} ` +
      `duplicatesEstimate=${
        (pendingMessages.length - pendingResult.count) +
        (systemMessages.length - systemResult.count) +
        (mediaMessages.length - mediaResult.count)
      }`,
    );

    const validMessagesStored = pendingResult.count;
    const duplicatesSkipped =
      pendingMessages.length - pendingResult.count +
      systemMessages.length - systemResult.count +
      mediaMessages.length - mediaResult.count;

    const timestamps = messages.map((m) => m.timestamp.getTime());
    const dateRangeStart = timestamps.length
      ? new Date(timestamps.reduce((a, b) => Math.min(a, b)))
      : null;
    const dateRangeEnd = timestamps.length
      ? new Date(timestamps.reduce((a, b) => Math.max(a, b)))
      : null;

    const uniqueSenders = new Set(
      messages.filter((m) => !m.isSystemMessage).map((m) => m.senderRaw),
    ).size;

    await this.contacts.upsertContactsFromMessages(
      tenantId,
      messages.filter((m) => !m.isSystemMessage),
    );

    const statsPayload = {
      totalParsed: messages.length,
      pending: validMessagesStored,
      system: systemMessages.length,
      media: mediaMessages.length,
      duplicates: duplicatesSkipped,
      parseErrors,
      uniqueSenders,
    };

    // Transition to CLASSIFYING and run classification inline
    await this.prisma.radarImport.updateMany({
      where: { id: importId, tenantId },
      data: {
        status: ImportStatus.CLASSIFYING,
        sourceGroupName,
        dateRangeStart,
        dateRangeEnd,
        stats: statsPayload,
      },
    });

    const { classified, skippedPrefilter, failed } =
      await this.classifier.classifyImportMessages(tenantId, importId);

    const finalStatus = failed > 0 ? ImportStatus.PARTIAL : ImportStatus.COMPLETED;

    const finalStats = {
      ...statsPayload,
      classified,
      skippedPrefilter,
      classificationFailed: failed,
    };

    const updatedImport = await this.prisma.radarImport.findFirst({
      where: { id: importId, tenantId },
      select: { listingsCreated: true },
    });

    await this.prisma.radarImport.updateMany({
      where: { id: importId, tenantId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        stats: finalStats,
      },
    });

    return {
      importId,
      status: finalStatus,
      sourceGroupName,
      dateRangeStart,
      dateRangeEnd,
      totalMessagesParsed: messages.length,
      validMessagesStored,
      duplicatesSkipped,
      systemMessagesSkipped: systemMessages.length,
      mediaMessagesSkipped: mediaMessages.length,
      parseErrors,
      uniqueSenders,
      listingsCreated: updatedImport?.listingsCreated ?? 0,
      classified,
      skippedPrefilter,
      classificationFailed: failed,
    };
  }

  private validateFile(file: MulterFile | undefined): void {
    if (!file) {
      throw new BadRequestException('No file uploaded. Use multipart/form-data with field "file"');
    }
    if (!file.originalname.toLowerCase().endsWith('.txt')) {
      throw new BadRequestException('Only .txt files are accepted');
    }
    if (file.buffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty');
    }
    // MIME is unreliable on upload (iOS sends text/plain; Android often sends
    // application/octet-stream for the same .txt file). We accept the file as
    // long as the extension is .txt and the buffer is valid UTF-8 without binary
    // null bytes (checked in RadarParserService). A non-text/plain MIME is logged
    // at the application layer for diagnostics but does not block the upload.
  }

  private async ensureExportChannel(tenantId: string) {
    return this.prisma.channel.upsert({
      where: {
        tenantId_externalChannelId: {
          tenantId,
          externalChannelId: EXPORT_CHANNEL_SENTINEL,
        },
      },
      update: {},
      create: {
        tenant: { connect: { id: tenantId } },
        type: ChannelType.WHATSAPP,
        name: 'WhatsApp Export',
        externalChannelId: EXPORT_CHANNEL_SENTINEL,
      },
    });
  }
}
