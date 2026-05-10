import { CatalogDataSource, PrismaClient } from '@prisma/client';

type WatchRefEntry = {
  brand: string;
  line: string | null;
  model: string;
  reference: string;
  aliases: string[];
  discontinued: boolean;
  approximateRetailUsd: number | null;
};

// ---------------------------------------------------------------------------
// Canonical watch reference catalog for AI Market Radar normalization.
// All aliases must be lowercase. Every entry must have at least one alias.
// approximateRetailUsd = authorized dealer price at time of writing (2025),
// or last known retail for discontinued references. Null where uncertain.
// ---------------------------------------------------------------------------
export const WATCH_REFERENCES: WatchRefEntry[] = [

  // =========================================================================
  // ROLEX — Submariner
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Submariner',
    model: 'Submariner No-Date',
    reference: '114060',
    aliases: ['sub no date', 'no date sub', 'nd sub', 'submariner no date', 'submariner', 'sub', '114060'],
    discontinued: true,
    approximateRetailUsd: 8100,
  },
  {
    brand: 'Rolex',
    line: 'Submariner',
    model: 'Submariner Date Black',
    reference: '116610LN',
    aliases: ['sub date', 'date sub', 'submariner date', 'submariner date black', '116610ln', '116610', 'sub black'],
    discontinued: true,
    approximateRetailUsd: 8100,
  },
  {
    brand: 'Rolex',
    line: 'Submariner',
    model: 'Submariner Date Black',
    reference: '126610LN',
    aliases: ['sub date', 'date sub', 'submariner date', 'new sub', 'current sub', '126610ln', '126610'],
    discontinued: false,
    approximateRetailUsd: 10050,
  },
  {
    brand: 'Rolex',
    line: 'Submariner',
    model: 'Submariner Date Hulk',
    reference: '116610LV',
    aliases: ['hulk', 'submariner hulk', 'sub hulk', 'green sub', 'green dial sub', '116610lv', 'hulk sub', 'green submariner'],
    discontinued: true,
    approximateRetailUsd: 9150,
  },
  {
    brand: 'Rolex',
    line: 'Submariner',
    model: 'Submariner Date Starbucks',
    reference: '126610LV',
    aliases: ['starbucks', 'sub starbucks', 'submariner starbucks', 'green bezel sub', 'kermit', 'new kermit', '126610lv', 'starbucks sub', 'green bezel submariner'],
    discontinued: false,
    approximateRetailUsd: 10300,
  },
  {
    brand: 'Rolex',
    line: 'Submariner',
    model: 'Submariner Date White Gold Blue Smurf',
    reference: '116619LB',
    aliases: ['smurf', 'sub smurf', 'submariner smurf', 'white gold sub', 'blue white gold sub', '116619lb', '116619'],
    discontinued: true,
    approximateRetailUsd: null,
  },
  {
    brand: 'Rolex',
    line: 'Submariner',
    model: 'Submariner Date White Gold Blue Smurf',
    reference: '126619LB',
    aliases: ['smurf', 'new smurf', 'submariner smurf', 'white gold sub', '126619lb', '126619'],
    discontinued: false,
    approximateRetailUsd: 42600,
  },

  {
    brand: 'Rolex',
    line: 'Submariner',
    model: 'Submariner Date Two-Tone Bluesy',
    reference: '116613LB',
    aliases: ['bluesy', 'bluesy sub', 'two tone sub', 'rolesor sub', 'submariner two tone', '116613lb', '116613', 'gold sub', 'old bluesy'],
    discontinued: true,
    approximateRetailUsd: 12100,
  },
  {
    brand: 'Rolex',
    line: 'Submariner',
    model: 'Submariner Date Two-Tone Bluesy',
    reference: '126613LB',
    aliases: ['bluesy', 'bluesy sub', 'two tone sub', 'rolesor sub', 'submariner two tone', '126613lb', '126613', 'gold sub'],
    discontinued: false,
    approximateRetailUsd: 14600,
  },

  // =========================================================================
  // ROLEX — GMT-Master II
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'GMT-Master II',
    model: 'GMT-Master II Black',
    reference: '116710LN',
    aliases: ['gmt', 'gmt master ii', 'gmt black', 'black gmt', 'blackout gmt', '116710ln', '116710'],
    discontinued: true,
    approximateRetailUsd: 9700,
  },
  {
    brand: 'Rolex',
    line: 'GMT-Master II',
    model: 'GMT-Master II Pepsi',
    reference: '126710BLRO',
    aliases: ['pepsi', 'gmt pepsi', 'pepsi gmt', 'red blue gmt', 'blro', '126710blro', '126710 blro', 'jubilee gmt', 'bicolor gmt', 'pepsi rolex', 'red blue bezel gmt'],
    discontinued: false,
    approximateRetailUsd: 13100,
  },
  {
    brand: 'Rolex',
    line: 'GMT-Master II',
    model: 'GMT-Master II Batman',
    reference: '116710BLNR',
    aliases: ['batman', 'gmt batman', 'batman gmt', 'blnr', '116710blnr', '116710 blnr', 'blue black gmt', 'batgirl'],
    discontinued: true,
    approximateRetailUsd: 9700,
  },
  {
    brand: 'Rolex',
    line: 'GMT-Master II',
    model: 'GMT-Master II Batman Jubilee',
    reference: '126710BLNR',
    aliases: ['batman', 'new batman', 'jubilee batman', 'blnr', '126710blnr', 'blue black gmt', 'current batman', 'jubilee blnr'],
    discontinued: false,
    approximateRetailUsd: 13100,
  },
  {
    brand: 'Rolex',
    line: 'GMT-Master II',
    model: 'GMT-Master II Sprite',
    reference: '126720VTNR',
    aliases: ['sprite', 'gmt sprite', 'sprite gmt', 'lefty gmt', 'left hand gmt', 'lefty', 'lhm', 'vtnr', '126720vtnr', 'green black gmt', 'left crown gmt'],
    discontinued: false,
    approximateRetailUsd: 13900,
  },
  {
    brand: 'Rolex',
    line: 'GMT-Master II',
    model: 'GMT-Master II Root Beer Everose',
    reference: '126715CHNR',
    aliases: ['rootbeer', 'root beer', 'gmt rootbeer', 'rootbeer gmt', 'everose gmt', 'rose gold gmt', 'chnr', '126715chnr', 'chocolate gmt', 'brown gmt'],
    discontinued: false,
    approximateRetailUsd: 39850,
  },

  // =========================================================================
  // ROLEX — Cosmograph Daytona
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Daytona',
    model: 'Cosmograph Daytona Ceramic',
    reference: '116500LN',
    aliases: ['daytona', 'ceramic daytona', 'panda', 'panda daytona', 'white daytona', '116500ln', '116500', 'ceramic bezel daytona'],
    discontinued: true,
    approximateRetailUsd: 13150,
  },
  {
    brand: 'Rolex',
    line: 'Daytona',
    model: 'Cosmograph Daytona Ceramic',
    reference: '126500LN',
    aliases: ['daytona', 'new daytona', 'ceramic daytona', 'panda', 'panda daytona', '126500ln', '126500', 'current daytona'],
    discontinued: false,
    approximateRetailUsd: 16550,
  },

  // =========================================================================
  // ROLEX — Explorer
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Explorer',
    model: 'Explorer 39mm',
    reference: '214270',
    aliases: ['explorer', 'rolex explorer', '214270', '39mm explorer', 'explorer 39'],
    discontinued: true,
    approximateRetailUsd: 6550,
  },
  {
    brand: 'Rolex',
    line: 'Explorer',
    model: 'Explorer 36mm',
    reference: '124270',
    aliases: ['explorer', 'new explorer', 'rolex explorer', '124270', 'explorer 36', '36mm explorer'],
    discontinued: false,
    approximateRetailUsd: 7850,
  },
  {
    brand: 'Rolex',
    line: 'Explorer II',
    model: 'Explorer II 42mm',
    reference: '216570',
    aliases: ['explorer ii', 'explorer 2', 'polar explorer', 'orange hand', '216570', 'polar', 'white polar', 'orange hand explorer'],
    discontinued: true,
    approximateRetailUsd: 8150,
  },
  {
    brand: 'Rolex',
    line: 'Explorer II',
    model: 'Explorer II 42mm',
    reference: '226570',
    aliases: ['explorer ii', 'explorer 2', 'new explorer ii', 'polar explorer', '226570', 'orange hand explorer', 'current explorer ii'],
    discontinued: false,
    approximateRetailUsd: 9950,
  },

  // =========================================================================
  // ROLEX — Datejust
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Datejust',
    model: 'Datejust 36',
    reference: '126234',
    aliases: ['datejust', 'datejust 36', 'dj', 'dj36', '126234', 'rolex datejust'],
    discontinued: false,
    approximateRetailUsd: 7100,
  },
  {
    brand: 'Rolex',
    line: 'Datejust',
    model: 'Datejust 41 Two-Tone',
    reference: '126333',
    aliases: ['datejust 41', 'dj41', '126333', 'two tone datejust', 'rolesor datejust', 'rolex datejust 41'],
    discontinued: false,
    approximateRetailUsd: 9150,
  },

  // =========================================================================
  // ROLEX — Day-Date
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Day-Date',
    model: 'Day-Date 40 Yellow Gold',
    reference: '228238',
    aliases: ['day date', 'day-date', 'presidents watch', 'president', 'dd40', '228238', 'yellow gold day date', 'day date 40'],
    discontinued: false,
    approximateRetailUsd: 37950,
  },

  // =========================================================================
  // ROLEX — Sea-Dweller / Deepsea
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Sea-Dweller',
    model: 'Sea-Dweller Single Red',
    reference: '126600',
    aliases: ['sea dweller', 'sd', 'single red', 'single red sea dweller', '126600', 'sdsd', 'sea-dweller'],
    discontinued: false,
    approximateRetailUsd: 12900,
  },
  {
    brand: 'Rolex',
    line: 'Sea-Dweller',
    model: 'Sea-Dweller Deepsea',
    reference: '136660',
    aliases: ['deepsea', 'sea dweller deepsea', 'deep sea', 'rolex deepsea', '136660', 'deepsea 44'],
    discontinued: false,
    approximateRetailUsd: 14600,
  },

  // =========================================================================
  // ROLEX — Milgauss
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Milgauss',
    model: 'Milgauss Green Crystal',
    reference: '116400GV',
    aliases: ['milgauss', 'green crystal milgauss', 'milgauss gv', '116400gv', 'milgauss green', 'lightning bolt milgauss'],
    discontinued: true,
    approximateRetailUsd: 7550,
  },

  // =========================================================================
  // ROLEX — Yacht-Master
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Yacht-Master',
    model: 'Yacht-Master 40 Oystersteel Platinum',
    reference: '126622',
    aliases: ['yacht master', 'yachtmaster', 'ym', '126622', 'ym40', 'yacht master 40', 'silver yacht master'],
    discontinued: false,
    approximateRetailUsd: 13950,
  },

  // =========================================================================
  // ROLEX — Sky-Dweller
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Sky-Dweller',
    model: 'Sky-Dweller White Rolesor Jubilee',
    reference: '336934',
    aliases: ['sky dweller', 'skydweller', 'sky-dweller', '336934', 'sky dweller jubilee'],
    discontinued: false,
    approximateRetailUsd: 18100,
  },

  // =========================================================================
  // ROLEX — Oyster Perpetual
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Oyster Perpetual',
    model: 'Oyster Perpetual 41',
    reference: '124300',
    aliases: ['oyster perpetual', 'op', 'oyster perpetual 41', 'op41', '124300', 'coral op', 'turquoise op', 'yellow op', 'green op'],
    discontinued: false,
    approximateRetailUsd: 6150,
  },

  // =========================================================================
  // ROLEX — Air-King
  // =========================================================================
  {
    brand: 'Rolex',
    line: 'Air-King',
    model: 'Air-King 40',
    reference: '126900',
    aliases: ['air king', 'air-king', 'airking', '126900', 'air king 40'],
    discontinued: false,
    approximateRetailUsd: 7750,
  },

  // =========================================================================
  // AUDEMARS PIGUET — Royal Oak
  // =========================================================================
  {
    brand: 'Audemars Piguet',
    line: 'Royal Oak',
    model: 'Royal Oak Jumbo Extra-Thin 39mm',
    reference: '15202ST',
    aliases: ['jumbo', 'royal oak jumbo', 'ap jumbo', '15202', '15202st', 'extra thin', 'thin royal oak', 'og jumbo', 'og royal oak', 'original jumbo'],
    discontinued: true,
    approximateRetailUsd: 30500,
  },
  {
    brand: 'Audemars Piguet',
    line: 'Royal Oak',
    model: 'Royal Oak Jumbo Extra-Thin 41mm',
    reference: '16202ST',
    aliases: ['jumbo', 'new jumbo', 'royal oak jumbo', 'ap jumbo', '16202', '16202st', '41mm jumbo', 'new og'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Audemars Piguet',
    line: 'Royal Oak',
    model: 'Royal Oak Self-Winding 39mm',
    reference: '15300ST',
    aliases: ['royal oak', 'ap royal oak', '15300', '15300st', '39mm royal oak', 'royal oak 39'],
    discontinued: true,
    approximateRetailUsd: null,
  },
  {
    brand: 'Audemars Piguet',
    line: 'Royal Oak',
    model: 'Royal Oak Self-Winding 41mm',
    reference: '15400ST',
    aliases: ['royal oak', 'ap royal oak', '15400', '15400st', 'royal oak 41', '41mm royal oak', 'ro41'],
    discontinued: true,
    approximateRetailUsd: 22400,
  },
  {
    brand: 'Audemars Piguet',
    line: 'Royal Oak',
    model: 'Royal Oak Self-Winding 41mm',
    reference: '15500ST',
    aliases: ['royal oak', 'ap royal oak', '15500', '15500st', 'new royal oak 41', 'current royal oak', 'ro 41', 'ro41'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Audemars Piguet',
    line: 'Royal Oak',
    model: 'Royal Oak Self-Winding 37mm',
    reference: '15450ST',
    aliases: ['royal oak 37', 'royal oak mid', '37mm royal oak', '15450', '15450st', 'mid size royal oak'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Audemars Piguet',
    line: 'Royal Oak',
    model: 'Royal Oak Chronograph 41mm',
    reference: '26240ST',
    aliases: ['royal oak chrono', 'ap chrono', 'roc', '26240', '26240st', 'royal oak chronograph', 'ro chrono'],
    discontinued: false,
    approximateRetailUsd: null,
  },

  // =========================================================================
  // AUDEMARS PIGUET — Royal Oak Offshore
  // =========================================================================
  {
    brand: 'Audemars Piguet',
    line: 'Royal Oak Offshore',
    model: 'Royal Oak Offshore Self-Winding 42mm',
    reference: '26470ST',
    aliases: ['offshore', 'roo', 'royal oak offshore', 'ap offshore', '26470', '26470st', 'roo 42'],
    discontinued: false,
    approximateRetailUsd: null,
  },

  // =========================================================================
  // PATEK PHILIPPE — Nautilus
  // =========================================================================
  {
    brand: 'Patek Philippe',
    line: 'Nautilus',
    model: 'Nautilus 40mm Steel Blue',
    reference: '5711/1A',
    aliases: ['nautilus', '5711', '5711a', '5711/1a', 'blue nautilus', 'steel nautilus', 'discontinued nautilus', 'holy grail nautilus', 'pp nautilus'],
    discontinued: true,
    approximateRetailUsd: 34893,
  },
  {
    brand: 'Patek Philippe',
    line: 'Nautilus',
    model: 'Nautilus 40mm Rose Gold',
    reference: '5711/1R',
    aliases: ['nautilus', 'rose gold nautilus', '5711r', '5711/1r', 'nautilus rose gold', 'pink nautilus', 'pp nautilus'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Patek Philippe',
    line: 'Nautilus',
    model: 'Nautilus Power Reserve Moonphase',
    reference: '5712/1A',
    aliases: ['nautilus', '5712', '5712a', '5712/1a', 'nautilus power reserve', 'moon nautilus', 'nautilus moonphase'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Patek Philippe',
    line: 'Nautilus',
    model: 'Nautilus Annual Calendar',
    reference: '5726/1A',
    aliases: ['nautilus', '5726', '5726a', '5726/1a', 'nautilus annual calendar', 'annual calendar nautilus', 'nac'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Patek Philippe',
    line: 'Nautilus',
    model: 'Nautilus Perpetual Calendar',
    reference: '5740/1G',
    aliases: ['nautilus', 'nautilus perpetual', '5740', '5740g', '5740/1g', 'nautilus perpetual calendar', 'npc'],
    discontinued: false,
    approximateRetailUsd: null,
  },

  // =========================================================================
  // PATEK PHILIPPE — Aquanaut
  // =========================================================================
  {
    brand: 'Patek Philippe',
    line: 'Aquanaut',
    model: 'Aquanaut 40mm Steel',
    reference: '5167A',
    aliases: ['aquanaut', '5167', '5167a', '5167a-001', 'pp aquanaut', 'black aquanaut', 'steel aquanaut'],
    discontinued: true,
    approximateRetailUsd: 29780,
  },
  {
    brand: 'Patek Philippe',
    line: 'Aquanaut',
    model: 'Aquanaut 42mm White Gold Khaki',
    reference: '5168G',
    aliases: ['aquanaut', '5168', '5168g', '5168g-010', 'white gold aquanaut', 'khaki aquanaut', 'green aquanaut'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Patek Philippe',
    line: 'Aquanaut',
    model: 'Aquanaut Travel Time Chronograph',
    reference: '5980/1AR',
    aliases: ['aquanaut chrono', 'aquanaut chronograph', '5980', 'travel time chrono', 'aquanaut travel time', '5980/1ar'],
    discontinued: true,
    approximateRetailUsd: null,
  },

  // =========================================================================
  // PATEK PHILIPPE — Calatrava & Complications
  // =========================================================================
  {
    brand: 'Patek Philippe',
    line: 'Calatrava',
    model: 'Calatrava 39mm White Gold',
    reference: '5227G',
    aliases: ['calatrava', '5227', '5227g', '5227g-001', 'white gold calatrava', 'pp calatrava'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Patek Philippe',
    line: 'Grand Complications',
    model: 'Perpetual Calendar Chronograph White Gold',
    reference: '5270G',
    aliases: ['perpetual calendar chrono', 'pcc', '5270', '5270g', '5270g-018', 'pp complicated', 'grand complication'],
    discontinued: false,
    approximateRetailUsd: null,
  },

  // =========================================================================
  // CARTIER — Santos
  // =========================================================================
  {
    brand: 'Cartier',
    line: 'Santos',
    model: 'Santos de Cartier Large 40mm',
    reference: 'WSSA0018',
    aliases: ['santos', 'santos de cartier', 'cartier santos', 'large santos', '40mm santos', 'santos steel', 'santos 40'],
    discontinued: false,
    approximateRetailUsd: 7500,
  },
  {
    brand: 'Cartier',
    line: 'Santos',
    model: 'Santos de Cartier Medium 35mm',
    reference: 'WSSA0009',
    aliases: ['santos', 'santos de cartier', 'medium santos', 'santos medium', 'santos 35', 'cartier santos medium'],
    discontinued: false,
    approximateRetailUsd: 6300,
  },
  {
    brand: 'Cartier',
    line: 'Santos',
    model: 'Santos-Dumont XL',
    reference: 'WGSA0021',
    aliases: ['santos dumont', 'dumont', 'santos-dumont', 'santos xl', 'cartier dumont'],
    discontinued: false,
    approximateRetailUsd: null,
  },

  // =========================================================================
  // CARTIER — Ballon Bleu
  // =========================================================================
  {
    brand: 'Cartier',
    line: 'Ballon Bleu',
    model: 'Ballon Bleu de Cartier 40mm',
    reference: 'WSBB0002',
    aliases: ['ballon bleu', 'balloon bleu', 'ballon', 'bb cartier', 'cartier ballon', 'ballon bleu 40', 'ballon bleu cartier'],
    discontinued: false,
    approximateRetailUsd: 7850,
  },

  // =========================================================================
  // CARTIER — Tank
  // =========================================================================
  {
    brand: 'Cartier',
    line: 'Tank',
    model: 'Tank Must Large',
    reference: 'WSTA0041',
    aliases: ['tank', 'cartier tank', 'tank must', 'new tank', 'tank must large', 'cartier tank must'],
    discontinued: false,
    approximateRetailUsd: 4450,
  },

  // =========================================================================
  // RICHARD MILLE
  // =========================================================================
  {
    brand: 'Richard Mille',
    line: 'RM',
    model: 'RM 011 Felipe Massa Flyback Chronograph',
    reference: 'RM 011',
    aliases: ['rm 011', 'rm011', 'rm11', 'richard mille 011', 'felipe massa', 'rm 011 chrono', 'rm11 chrono'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Richard Mille',
    line: 'RM',
    model: 'RM 027 Tourbillon Rafael Nadal',
    reference: 'RM 027',
    aliases: ['rm 027', 'rm027', 'rm27', 'nadal', 'tourbillon nadal', 'ultra light', 'nadal tourbillon', 'richard mille nadal', 'nadal rm'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Richard Mille',
    line: 'RM',
    model: 'RM 035 Americas',
    reference: 'RM 035',
    aliases: ['rm 035', 'rm035', 'rm35', 'americas', 'richard mille 035', 'rm americas'],
    discontinued: false,
    approximateRetailUsd: null,
  },
  {
    brand: 'Richard Mille',
    line: 'RM',
    model: 'RM 055 Bubba Watson',
    reference: 'RM 055',
    aliases: ['rm 055', 'rm055', 'rm55', 'bubba', 'bubba watson', 'richard mille 055', 'bubba rm'],
    discontinued: false,
    approximateRetailUsd: null,
  },

  // =========================================================================
  // OMEGA — Speedmaster
  // =========================================================================
  {
    brand: 'Omega',
    line: 'Speedmaster',
    model: 'Speedmaster Professional Moonwatch',
    reference: '311.30.42.30.01.005',
    aliases: ['speedmaster', 'moonwatch', 'moon watch', 'speedy', 'professional', 'speedy pro', 'moonwatch omega', 'omega moonwatch'],
    discontinued: false,
    approximateRetailUsd: 6350,
  },

  // =========================================================================
  // OMEGA — Seamaster
  // =========================================================================
  {
    brand: 'Omega',
    line: 'Seamaster',
    model: 'Seamaster Diver 300M 42mm',
    reference: '210.30.42.20.01.001',
    aliases: ['seamaster', 'seamaster 300', 'sm300', 'diver 300', 'diver 300m', 'omega diver', 'seamaster blue', 'seamaster diver'],
    discontinued: false,
    approximateRetailUsd: 5500,
  },
  {
    brand: 'Omega',
    line: 'Seamaster',
    model: 'Seamaster Aqua Terra 41mm',
    reference: '220.10.41.21.01.001',
    aliases: ['aqua terra', 'at', 'omega at', 'seamaster aqua terra', 'aqua terra 41', 'omega aqua terra', 'seamaster at'],
    discontinued: false,
    approximateRetailUsd: 5800,
  },

  // =========================================================================
  // OMEGA — Planet Ocean
  // =========================================================================
  {
    brand: 'Omega',
    line: 'Seamaster',
    model: 'Planet Ocean 600M 43.5mm',
    reference: '215.30.44.21.01.001',
    aliases: ['planet ocean', 'po', 'omega planet ocean', 'planet ocean 600m', 'po600', 'planet ocean 44'],
    discontinued: false,
    approximateRetailUsd: 6100,
  },

  // =========================================================================
  // TUDOR — Black Bay
  // =========================================================================
  {
    brand: 'Tudor',
    line: 'Black Bay',
    model: 'Black Bay 41 Black Bezel',
    reference: 'M79230N',
    aliases: ['black bay', 'tudor black bay', 'bb', 'tudor bb', 'black bay 41', 'bb41', 'tudor heritage', 'tudor black bay 41'],
    discontinued: false,
    approximateRetailUsd: 3925,
  },
  {
    brand: 'Tudor',
    line: 'Black Bay',
    model: 'Black Bay 36',
    reference: 'M32000-0001',
    aliases: ['black bay 36', 'bb36', 'tudor 36', 'tudor black bay 36', 'small black bay', 'tudor bb36'],
    discontinued: false,
    approximateRetailUsd: 3500,
  },
  {
    brand: 'Tudor',
    line: 'Black Bay GMT',
    model: 'Black Bay GMT Red Blue',
    reference: 'M79360N',
    aliases: ['tudor gmt', 'black bay gmt', 'bb gmt', 'tudor bb gmt', 'tudor pepsi', 'tudor gmt master', 'tudor gmt red blue'],
    discontinued: false,
    approximateRetailUsd: 3825,
  },
  {
    brand: 'Tudor',
    line: 'Black Bay GMT',
    model: 'Black Bay Pro GMT',
    reference: 'M91650-0001',
    aliases: ['black bay pro', 'bb pro', 'tudor pro', 'tudor gmt pro', 'black bay gmt pro', 'tudor bb pro'],
    discontinued: false,
    approximateRetailUsd: 3925,
  },

  // =========================================================================
  // TUDOR — Pelagos
  // =========================================================================
  {
    brand: 'Tudor',
    line: 'Pelagos',
    model: 'Pelagos 42mm Blue Titanium',
    reference: 'M25610TNL-0001',
    aliases: ['pelagos', 'tudor pelagos', 'tudor diver', 'pelagos titanium', 'pelagos blue'],
    discontinued: false,
    approximateRetailUsd: 4100,
  },

  // =========================================================================
  // TUDOR — Ranger
  // =========================================================================
  {
    brand: 'Tudor',
    line: 'Ranger',
    model: 'Ranger 39mm',
    reference: 'M79950-0001',
    aliases: ['tudor ranger', 'ranger', 'tudor 39', 'tudor ranger 39'],
    discontinued: false,
    approximateRetailUsd: 2550,
  },
];

// ---------------------------------------------------------------------------

export async function seedWatchReferences(prisma: PrismaClient): Promise<number> {
  let upsertCount = 0;

  for (const entry of WATCH_REFERENCES) {
    await prisma.watchReference.upsert({
      where: {
        brand_model_reference: {
          brand: entry.brand,
          model: entry.model,
          reference: entry.reference,
        },
      },
      update: {
        line: entry.line,
        aliases: entry.aliases,
        discontinued: entry.discontinued,
        approximateRetailUsd: entry.approximateRetailUsd ?? null,
        catalogSource: CatalogDataSource.MANUAL_ENTRY,
      },
      create: {
        brand: entry.brand,
        line: entry.line,
        model: entry.model,
        reference: entry.reference,
        aliases: entry.aliases,
        discontinued: entry.discontinued,
        approximateRetailUsd: entry.approximateRetailUsd ?? null,
        catalogSource: CatalogDataSource.MANUAL_ENTRY,
      },
    });
    upsertCount++;
  }

  return upsertCount;
}
