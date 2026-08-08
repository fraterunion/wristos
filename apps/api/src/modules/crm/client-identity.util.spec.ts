import {
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientPhone,
  clientNameMatchKey,
  clientPhoneMatchKey,
} from './client-identity.util';

describe('client-identity.util', () => {
  describe('normalizeClientName', () => {
    it('trims and collapses whitespace', () => {
      expect(normalizeClientName('  José   Hernández  ')).toBe('José Hernández');
    });

    it('preserves accents', () => {
      expect(normalizeClientName('José Hernández')).toBe('José Hernández');
    });
  });

  describe('clientNameMatchKey', () => {
    it('folds accents for probable matching', () => {
      expect(clientNameMatchKey('José Hernández')).toBe(clientNameMatchKey('Jose Hernandez'));
    });
  });

  describe('normalizeClientEmail', () => {
    it('trims and lowercases', () => {
      expect(normalizeClientEmail('  Ana@Email.COM ')).toBe('ana@email.com');
    });

    it('blank → null', () => {
      expect(normalizeClientEmail('  ')).toBeNull();
      expect(normalizeClientEmail(null)).toBeNull();
    });
  });

  describe('normalizeClientPhone', () => {
    it('maps 10-digit MX local to +52', () => {
      expect(normalizeClientPhone('55 1234 5678')).toBe('+525512345678');
    });

    it('maps 52-prefixed 12 digits', () => {
      expect(normalizeClientPhone('525512345678')).toBe('+525512345678');
    });

    it('preserves explicit + international', () => {
      expect(normalizeClientPhone('+1 (415) 555-0100')).toBe('+14155550100');
    });

    it('rejects too-short', () => {
      expect(normalizeClientPhone('12345')).toBeNull();
    });

    it('blank → null', () => {
      expect(normalizeClientPhone('')).toBeNull();
    });
  });

  describe('clientPhoneMatchKey', () => {
    it('matches equivalent MX forms', () => {
      expect(clientPhoneMatchKey(normalizeClientPhone('5512345678'))).toBe(
        clientPhoneMatchKey(normalizeClientPhone('+52 55 1234 5678')),
      );
    });
  });
});
