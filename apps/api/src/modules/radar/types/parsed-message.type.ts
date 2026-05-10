export type ParsedMessage = {
  senderRaw: string;
  timestamp: Date;
  content: string;
  hasMedia: boolean;
  isSystemMessage: boolean;
};

export type ParseResult = {
  messages: ParsedMessage[];
  sourceGroupName: string | null;
  parseErrors: number;
};
