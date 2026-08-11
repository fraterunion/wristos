/**
 * Offline WC-shaped fixture for watch-intelligence dry-run when live DB is unavailable.
 * Brands/models only — no serials. Derived from known WC inventory shape (abbrev brands + nickname models).
 */
export const WC_FIXTURE_ROWS = [
  { id: 'wc-elephant', brand: 'AP', model: 'Elephant', referenceNumber: null, status: 'AVAILABLE' },
  { id: 'wc-bruce', brand: 'ROLEX', model: 'BRUCE WAYN 2025', referenceNumber: null, status: 'AVAILABLE' },
  { id: 'wc-james', brand: 'ROLEX', model: 'JAMES CAMERON', referenceNumber: null, status: 'AVAILABLE' },
  { id: 'wc-tiffany-d', brand: 'ROLEX', model: 'Daytona Tiffany', referenceNumber: null, status: 'AVAILABLE' },
  { id: 'wc-tudor-panda', brand: 'TUDOR', model: 'Panda', referenceNumber: null, status: 'AVAILABLE' },
  { id: 'wc-omega-sm', brand: 'OMEGA', model: 'SPEED MASTER', referenceNumber: null, status: 'AVAILABLE' },
  { id: 'wc-patek-aq', brand: 'PATEK', model: 'AQUANAUT ORO ROSA', referenceNumber: null, status: 'AVAILABLE' },
  { id: 'wc-ap-safari', brand: 'AP', model: 'Safari', referenceNumber: null, status: 'AVAILABLE' },
];

export const DEMO_FIXTURE_ROWS = [
  {
    id: 'demo-pepsi',
    brand: 'Rolex',
    model: 'GMT-Master II Pepsi',
    referenceNumber: '126710BLRO',
    status: 'AVAILABLE',
  },
  {
    id: 'demo-batman',
    brand: 'Rolex',
    model: 'GMT-Master II Batman',
    referenceNumber: '126710BLNR',
    status: 'AVAILABLE',
  },
  {
    id: 'demo-bruce',
    brand: 'Rolex',
    model: 'GMT-Master II Bruce Wayne',
    referenceNumber: '126710GRNR',
    status: 'AVAILABLE',
  },
  {
    id: 'demo-sprite',
    brand: 'Rolex',
    model: 'GMT-Master II Sprite',
    referenceNumber: '126720VTNR',
    status: 'AVAILABLE',
  },
  {
    id: 'demo-panda',
    brand: 'Rolex',
    model: 'Daytona Panda',
    referenceNumber: '126500LN',
    status: 'AVAILABLE',
  },
  {
    id: 'demo-nautilus',
    brand: 'Patek Philippe',
    model: 'Nautilus',
    referenceNumber: '5711/1A-010',
    status: 'AVAILABLE',
  },
  {
    id: 'demo-overseas',
    brand: 'Vacheron Constantin',
    model: 'Overseas',
    referenceNumber: null,
    status: 'AVAILABLE',
  },
];
