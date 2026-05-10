export type ImportSummary = {
  importId: string;
  status: string;
  sourceGroupName: string | null;
  dateRangeStart: Date | null;
  dateRangeEnd: Date | null;
  totalMessagesParsed: number;
  validMessagesStored: number;
  duplicatesSkipped: number;
  systemMessagesSkipped: number;
  mediaMessagesSkipped: number;
  parseErrors: number;
  uniqueSenders: number;
};
