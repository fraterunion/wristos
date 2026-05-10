import { BadRequestException, Injectable } from '@nestjs/common';
import { ParseResult } from '../types/parsed-message.type';
import { parseWhatsAppExport } from '../utils/whatsapp-parser.util';

const MAX_MESSAGES = 50_000;

@Injectable()
export class RadarParserService {
  parse(buffer: Buffer, originalFilename: string): ParseResult {
    if (buffer.includes(0x00)) {
      throw new BadRequestException('File contains binary data and cannot be processed as text');
    }

    const text = buffer.toString('utf8');
    const result = parseWhatsAppExport(text, originalFilename);

    if (result.messages.length > MAX_MESSAGES) {
      throw new BadRequestException(
        `File contains too many messages (${result.messages.length.toLocaleString()} found, maximum is ${MAX_MESSAGES.toLocaleString()})`,
      );
    }

    return result;
  }
}
