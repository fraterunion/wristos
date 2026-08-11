import {
  BRAND_ABBREVIATIONS,
  WATCH_KNOWLEDGE_ENTRIES,
  WATCH_KNOWLEDGE_VERSION,
} from './catalog';
import {
  expandWatchKnowledge,
  knowledgeAmbiguityLevel,
  normalizeWatchQuery,
} from './expand';
import { normalizeReference, normalizeWatchText, withinTypoDistance } from './normalize';
import {
  rankAndResolveCandidates,
  scoreWatchCandidate,
  type InventoryWatchRow,
} from './score';

describe('Watch knowledge catalog V1', () => {
  it('is versioned and non-empty', () => {
    expect(WATCH_KNOWLEDGE_VERSION).toBe('1.0.0');
    expect(WATCH_KNOWLEDGE_ENTRIES.length).toBeGreaterThan(20);
    expect(BRAND_ABBREVIATIONS.map((b) => b.abbrev)).toEqual(
      expect.arrayContaining(['AP', 'PP', 'VC', 'JLC', 'RM', 'IWC']),
    );
  });

  it('flags ambiguous nicknames without forcing uniqueness', () => {
    const pandaEntries = WATCH_KNOWLEDGE_ENTRIES.filter((e) =>
      e.nicknames.some((n) => n.toLowerCase() === 'panda'),
    );
    expect(pandaEntries.length).toBeGreaterThan(1);
    expect(pandaEntries.every((e) => e.ambiguousNickname === true)).toBe(true);
  });
});

describe('Watch knowledge test table', () => {
  const cases: Array<{
    input: string;
    brand?: string;
    nicknames?: string[];
    ambiguity: 'unique_concept' | 'ambiguous' | 'brand_family' | 'none';
  }> = [
    { input: 'AP Elephant', brand: 'Audemars Piguet', nicknames: ['Elephant'], ambiguity: 'unique_concept' },
    { input: 'Elephant', nicknames: ['Elephant'], ambiguity: 'unique_concept' },
    { input: 'Bruce Wayne', nicknames: ['Bruce Wayne'], ambiguity: 'unique_concept' },
    { input: 'Batman', nicknames: ['Batman'], ambiguity: 'unique_concept' },
    { input: 'Batgirl', nicknames: ['Batgirl'], ambiguity: 'unique_concept' },
    { input: 'Sprite', nicknames: ['Sprite'], ambiguity: 'unique_concept' },
    { input: 'Pepsi', nicknames: ['Pepsi'], ambiguity: 'unique_concept' },
    { input: 'Pikachu', nicknames: ['Pikachu'], ambiguity: 'unique_concept' },
    { input: 'Panda', nicknames: ['Panda'], ambiguity: 'ambiguous' },
    { input: 'AP Panda', brand: 'Audemars Piguet', nicknames: ['Panda'], ambiguity: 'ambiguous' },
    { input: 'Rolex Panda', brand: 'Rolex', nicknames: ['Panda'], ambiguity: 'ambiguous' },
    { input: 'PP Nautilus', brand: 'Patek Philippe', ambiguity: 'brand_family' },
    { input: 'VC Overseas', brand: 'Vacheron Constantin', ambiguity: 'brand_family' },
    { input: 'Ghost', nicknames: ['Ghost'], ambiguity: 'ambiguous' },
  ];

  it.each(cases)('$input → brand=$brand ambiguity=$ambiguity', ({ input, brand, nicknames, ambiguity }) => {
    const q = normalizeWatchQuery(input);
    if (brand) expect(q.brandHint).toBe(brand);
    if (nicknames) {
      for (const n of nicknames) {
        expect(q.nicknameHits.map((h) => h.toLowerCase())).toContain(n.toLowerCase());
      }
    }
    expect(knowledgeAmbiguityLevel(q)).toBe(ambiguity);
  });
});

describe('Reference + text normalization', () => {
  it('normalizes reference formatting variants to the same key', () => {
    expect(normalizeReference('126710BLNR')).toBe('126710BLNR');
    expect(normalizeReference('126710 BLNR')).toBe('126710BLNR');
    expect(normalizeReference('126710-BLNR')).toBe('126710BLNR');
  });

  it('normalizes casing and punctuation without destroying tokens', () => {
    expect(normalizeWatchText('  AP  Elephant!! ')).toBe('ap elephant');
  });

  it('supports conservative brand typos', () => {
    expect(withinTypoDistance('audimar', 'audemars', 2)).toBe(true);
    expect(withinTypoDistance('pateck', 'patek', 2)).toBe(true);
    const q = normalizeWatchQuery('audimar elephant');
    expect(q.brandHint).toBe('Audemars Piguet');
  });
});

describe('Inventory scoring trust boundary', () => {
  const elephant: InventoryWatchRow = {
    id: 'w-el',
    brand: 'AP',
    model: 'Elephant',
    referenceNumber: null,
    status: 'AVAILABLE',
  };
  const pepsi: InventoryWatchRow = {
    id: 'w-pepsi',
    brand: 'Rolex',
    model: 'GMT-Master II Pepsi',
    referenceNumber: '126710BLRO',
    status: 'AVAILABLE',
  };
  const batman: InventoryWatchRow = {
    id: 'w-bat',
    brand: 'Rolex',
    model: 'GMT-Master II Batman',
    referenceNumber: '126710BLNR',
    status: 'AVAILABLE',
  };
  const pandaRolex: InventoryWatchRow = {
    id: 'w-panda-r',
    brand: 'Rolex',
    model: 'Daytona Panda',
    referenceNumber: '126500LN',
    status: 'AVAILABLE',
  };
  const pandaAp: InventoryWatchRow = {
    id: 'w-panda-ap',
    brand: 'AP',
    model: 'ROO Panda',
    referenceNumber: null,
    status: 'AVAILABLE',
  };
  const sold: InventoryWatchRow = {
    id: 'w-sold',
    brand: 'AP',
    model: 'Elephant',
    referenceNumber: null,
    status: 'SOLD',
  };

  function resolve(query: string, rows: InventoryWatchRow[]) {
    const q = normalizeWatchQuery(query);
    const concept = expandWatchKnowledge(q);
    const scored = rows
      .map((r) => scoreWatchCandidate(r, q, concept))
      .filter(Boolean) as NonNullable<ReturnType<typeof scoreWatchCandidate>>[];
    return rankAndResolveCandidates(scored);
  }

  it('AP Elephant binds unique AP inventory row', () => {
    const { unique, picker } = resolve('AP Elephant', [elephant, pepsi]);
    expect(unique?.id).toBe('w-el');
    expect(picker).toHaveLength(0);
  });

  it('Elephant alone binds when one strong match', () => {
    const { unique } = resolve('Elephant', [elephant, pepsi]);
    expect(unique?.id).toBe('w-el');
  });

  it('Pepsi binds Rolex Pepsi', () => {
    const { unique } = resolve('Pepsi', [pepsi, batman]);
    expect(unique?.id).toBe('w-pepsi');
  });

  it('exact reference outranks nickname', () => {
    const { unique } = resolve('Pepsi 126710BLNR', [pepsi, batman]);
    expect(unique?.id).toBe('w-bat');
    expect(unique?.scoreKind).toBe('EXACT_REFERENCE');
  });

  it('Panda alone is ambiguous across brands', () => {
    const { unique, picker } = resolve('Panda', [pandaRolex, pandaAp]);
    expect(unique).toBeNull();
    expect(picker.map((p) => p.id).sort()).toEqual(['w-panda-ap', 'w-panda-r']);
  });

  it('AP Panda narrows to AP', () => {
    const { unique, picker } = resolve('AP Panda', [pandaRolex, pandaAp]);
    expect(unique?.id).toBe('w-panda-ap');
    expect(picker).toHaveLength(0);
  });

  it('Rolex Panda narrows to Rolex', () => {
    const { unique } = resolve('Rolex Panda', [pandaRolex, pandaAp]);
    expect(unique?.id).toBe('w-panda-r');
  });

  it('does not invent ids when inventory empty', () => {
    const { unique, picker, rejectWeak } = resolve('AP Elephant', []);
    expect(unique).toBeNull();
    expect(picker).toHaveLength(0);
    expect(rejectWeak).toBe(true);
  });

  it('reference formatting variants match', () => {
    const { unique } = resolve('126710-BLRO', [pepsi, batman]);
    expect(unique?.id).toBe('w-pepsi');
  });

  it('sold rows are scorers responsibility of eligibility filter (still scoreable if passed)', () => {
    // Eligibility is applied in WatchInventoryResolver before scoring.
    const { unique } = resolve('Elephant', [sold]);
    expect(unique?.id).toBe('w-sold');
  });
});
