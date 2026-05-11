export type RadarIntent = 'SELL_OFFER' | 'BUY_REQUEST' | 'PRICE_SIGNAL' | 'GENERAL_INQUIRY';

export type RadarReviewStatus = 'PENDING_REVIEW' | 'CONFIRMED' | 'DISMISSED';

export type RadarReferenceSource = 'EXPLICIT' | 'INFERRED';

export type RadarImportStatus =
  | 'PENDING'
  | 'PARSING'
  | 'CLASSIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'PARTIAL';

export type WatchReference = {
  id: string;
  brand: string;
  model: string;
  reference: string;
  line: string | null;
  approximateRetailUsd: string | null;
};

export type RadarListingCard = {
  id: string;
  intent: RadarIntent;
  brand: string | null;
  rawModelMention: string | null;
  referenceNumberExplicit: string | null;
  referenceSource: RadarReferenceSource | null;
  priceAmount: string | null;
  priceCurrency: string | null;
  feedConfidence: number;
  reviewStatus: RadarReviewStatus;
  urgencyDetected: boolean;
  aiSummary: string;
  createdAt: string;
  contact: { id: string; displayName: string | null };
  message: {
    importId: string;
    postedAt: string;
    import: { sourceGroupName: string | null };
  };
};

export type RadarListingDetail = {
  id: string;
  messageId: string;
  contactId: string;
  watchReferenceId: string | null;
  intent: RadarIntent;
  reviewStatus: RadarReviewStatus;
  referenceSource: RadarReferenceSource | null;
  brand: string | null;
  feedConfidence: number;
  initialConfidence: number;
  rawModelMention: string | null;
  referenceNumberExplicit: string | null;
  aiSummary: string;
  urgencyDetected: boolean;
  conditionNotes: string | null;
  hasBox: boolean | null;
  hasPapers: boolean | null;
  year: number | null;
  dealerNotes: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  dismissedBy: string | null;
  dismissedAt: string | null;
  title: string | null;
  description: string | null;
  priceAmount: string | null;
  priceCurrency: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    displayName: string | null;
    phone: string | null;
    whatsappId: string | null;
  };
  watchReference: WatchReference | null;
  message: {
    id: string;
    content: string;
    senderRaw: string;
    postedAt: string;
    importId: string;
    import: {
      id: string;
      sourceGroupName: string | null;
      dateRangeStart: string | null;
      dateRangeEnd: string | null;
    };
  };
};

export type RadarImportSummary = {
  importId: string;
  status: RadarImportStatus;
  sourceGroupName: string | null;
  totalMessagesParsed: number;
  validMessagesStored: number;
  systemMessagesSkipped: number;
  mediaMessagesSkipped: number;
  duplicatesSkipped: number;
  parseErrors: number;
  uniqueSenders: number;
  listingsCreated: number;
  classified: number;
  skippedPrefilter: number;
  classificationFailed: number;
};

export type RadarContactProfile = {
  id: string;
  displayName: string | null;
  phone: string | null;
  clientId: string | null;
  rawIdentifiers: Record<string, string>;
  messageCount: number;
  listingCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  recentListings: RadarListingCard[];
  recentRequests: RadarListingCard[];
};

export type RadarListingsResponse = {
  listings: RadarListingCard[];
  total: number;
  page: number;
  limit: number;
};

export type RadarReviewQueueResponse = {
  listings: RadarListingDetail[];
  total: number;
  page: number;
  limit: number;
};

export type ListRadarListingsParams = {
  q?: string;
  intent?: RadarIntent;
  reviewStatus?: RadarReviewStatus;
  brand?: string;
  dateFrom?: string;
  dateTo?: string;
  priceMin?: number;
  priceMax?: number;
  minConfidence?: number;
  sort?: 'newest' | 'confidence' | 'price';
  page?: number;
  limit?: number;
};

export type UpdateRadarListingPayload = {
  brand?: string;
  watchReferenceId?: string;
  referenceNumber?: string;
  conditionNotes?: string;
  priceAmount?: number;
  priceCurrency?: string;
  hasBox?: boolean;
  hasPapers?: boolean;
  year?: number;
  intent?: RadarIntent;
  dealerNotes?: string;
};

export type SearchRadarReferencesParams = {
  q?: string;
  brand?: string;
  limit?: number;
};
