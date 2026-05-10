import { ParsedMessage, ParseResult } from '../types/parsed-message.type';

// iPhone: [d/m/yy, h:mm[:ss] [AM|PM]] rest
const IPHONE_RE =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+(AM|PM))?\]\s+([\s\S]*)$/i;

// Android: d/m/yy, h:mm [AM|PM] - rest
// Narrow no-break space ( ) may appear between time and AM/PM in some Android exports
const ANDROID_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s+(\d{1,2}):(\d{2})(?:[\s ]+(AM|PM))?\s+-\s+([\s\S]*)$/i;

// Sender name followed by colon + content
const SENDER_RE = /^([^:]+):\s+([\s\S]*)$/;

const MEDIA_SUBSTRINGS = [
  '<media omitted>',
  'image omitted',
  'video omitted',
  'audio omitted',
  'sticker omitted',
  'document omitted',
  'gif omitted',
];

const SYSTEM_SUBSTRINGS = [
  'messages and calls are end-to-end encrypted',
  'this message was deleted',
  'you deleted this message',
  'joined using this group',
  'joined using an invite link',
  ' left',
  ' added ',
  ' removed ',
  'changed the group name',
  'changed the group description',
  "changed this group's icon",
  'changed the subject',
  'waiting for this message',
  'security code changed',
  'disappearing messages',
  'created group',
  'was added',
  'was removed',
];

function isMediaContent(content: string): boolean {
  const lower = content.trim().toLowerCase();
  return MEDIA_SUBSTRINGS.some((s) => lower.includes(s));
}

function isSystemContent(content: string): boolean {
  const lower = content.trim().toLowerCase();
  return SYSTEM_SUBSTRINGS.some((s) => lower.includes(s));
}

// Scan early lines to determine date format.
// Returns true if day-first (DD/MM/YY), false if month-first (MM/DD/YY).
function isDayFirst(lines: string[]): boolean {
  const dateRe = /[\[]?(\d{1,2})\/(\d{1,2})\/\d{2,4}/;
  for (const line of lines.slice(0, 40)) {
    const m = dateRe.exec(line);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 12) return true;  // first component > 12 → must be day
    if (b > 12) return false; // second component > 12 → first must be month
  }
  return false; // default: MM/DD/YY (US format)
}

function normalizeYear(y: number): number {
  if (y >= 100) return y;
  return y < 30 ? 2000 + y : 1900 + y;
}

function normalizeHour(hour: number, ampm: string | undefined): number {
  if (!ampm) return hour;
  const isPm = ampm.toUpperCase() === 'PM';
  if (isPm && hour !== 12) return hour + 12;
  if (!isPm && hour === 12) return 0;
  return hour;
}

function buildTimestamp(
  a: number,
  b: number,
  rawYear: number,
  hour: number,
  minute: number,
  second: number,
  ampm: string | undefined,
  dayFirst: boolean,
): Date | null {
  const month = dayFirst ? b : a;
  const day = dayFirst ? a : b;
  const year = normalizeYear(rawYear);
  const h = normalizeHour(hour, ampm);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const d = new Date(Date.UTC(year, month - 1, day, h, minute, second));
  return isNaN(d.getTime()) ? null : d;
}

type RawEntry = { timestamp: Date; rest: string };

function tryIphone(line: string, dayFirst: boolean): RawEntry | null {
  const m = IPHONE_RE.exec(line);
  if (!m) return null;
  const ts = buildTimestamp(
    parseInt(m[1], 10),
    parseInt(m[2], 10),
    parseInt(m[3], 10),
    parseInt(m[4], 10),
    parseInt(m[5], 10),
    m[6] ? parseInt(m[6], 10) : 0,
    m[7] ?? undefined,
    dayFirst,
  );
  return ts ? { timestamp: ts, rest: m[8] } : null;
}

function tryAndroid(line: string, dayFirst: boolean): RawEntry | null {
  const m = ANDROID_RE.exec(line);
  if (!m) return null;
  const ts = buildTimestamp(
    parseInt(m[1], 10),
    parseInt(m[2], 10),
    parseInt(m[3], 10),
    parseInt(m[4], 10),
    parseInt(m[5], 10),
    0,
    m[6] ?? undefined,
    dayFirst,
  );
  return ts ? { timestamp: ts, rest: m[7] } : null;
}

function extractGroupName(filename: string): string | null {
  let name = filename.replace(/\.txt$/i, '').trim();
  name = name.replace(/^WhatsApp Chat with\s+/i, '').trim();
  return name || null;
}

type InProgress = {
  senderRaw: string;
  timestamp: Date;
  content: string;
  hasMedia: boolean;
  isSystemMessage: boolean;
};

export function parseWhatsAppExport(text: string, originalFilename: string): ParseResult {
  // Normalize line endings and narrow no-break space in timestamps
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');

  const dayFirst = isDayFirst(lines);
  const sourceGroupName = extractGroupName(originalFilename);

  const messages: ParsedMessage[] = [];
  let parseErrors = 0;
  let current: InProgress | null = null;

  const flush = () => {
    if (current) {
      messages.push({ ...current });
      current = null;
    }
  };

  for (const rawLine of lines) {
    // Normalize narrow no-break space that appears in some Android timestamps
    const line = rawLine.replace(/ /g, ' ');

    if (!line.trim()) continue;

    const entry = tryIphone(line, dayFirst) ?? tryAndroid(line, dayFirst);

    if (entry) {
      flush();

      const senderMatch = SENDER_RE.exec(entry.rest);
      if (senderMatch) {
        const senderRaw = senderMatch[1].trim();
        const content = senderMatch[2];
        if (!content.trim()) continue; // skip sender lines with no actual content
        current = {
          senderRaw,
          timestamp: entry.timestamp,
          content,
          hasMedia: isMediaContent(content),
          isSystemMessage: false,
        };
      } else {
        // No sender:content pattern → system message
        const content = entry.rest.trim();
        if (!content) continue;
        current = {
          senderRaw: 'system',
          timestamp: entry.timestamp,
          content,
          hasMedia: false,
          isSystemMessage: true,
        };
      }
    } else if (current) {
      // Continuation of previous message
      current.content += '\n' + line;
      if (!current.hasMedia && isMediaContent(line)) {
        current.hasMedia = true;
      }
    } else {
      // Unparseable line before any message (header, BOM, etc.)
      parseErrors++;
    }
  }

  flush();

  return { messages, sourceGroupName, parseErrors };
}
