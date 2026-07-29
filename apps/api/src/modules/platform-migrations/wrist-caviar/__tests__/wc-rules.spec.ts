import {
  classifyCustomerNamePair,
  classifyPartnerMovement,
  classifyPayableCard,
  classifyReceivableCard,
  currentInventoryRequiresSerial,
  DEFERRED_SHEET_RULES,
  expectedProfitShare,
  isBankOnePercentCommission,
  isDeferredGroup,
  isRunningBalanceOnlyRow,
  isSupportedProfitPartner,
  normalizeExpenseLabel,
  resolveExpenseCategory,
  applyHistoricalSaleFieldRules,
} from '../../../../../../../scripts/migrations/wrist-caviar/rules';

describe('wrist-caviar deterministic rules', () => {
  it('1. blank CXC block excluded', () => {
    const r = classifyReceivableCard({ principal: null, payments: [] });
    expect(r?.disposition).toBe('EXCLUDED');
    expect(r?.audit.ruleId).toBe('WC_EXCLUDE_EMPTY_CXC_CARD');
  });

  it('2. blank CXP block excluded', () => {
    const r = classifyPayableCard({ principal: null, payments: [] });
    expect(r?.disposition).toBe('EXCLUDED');
    expect(r?.audit.ruleId).toBe('WC_EXCLUDE_EMPTY_CXP_CARD');
  });

  it('3. valid free-form creditor accepted when card otherwise valid', () => {
    const empty = classifyPayableCard({ principal: 1000, payments: [] });
    expect(empty).toBeNull();
  });

  it('4. historical missing serial does not block Deal', () => {
    const r = applyHistoricalSaleFieldRules({ serial: null, reference: '116655' });
    expect(r.serial).toBeNull();
    expect(r.audits.some((a) => a.audit.ruleId === 'WC_SERIAL_OPTIONAL_FOR_HISTORICAL_SALE')).toBe(
      true,
    );
  });

  it('5. historical missing reference does not block Deal', () => {
    const r = applyHistoricalSaleFieldRules({ serial: 'ABC', reference: null });
    expect(r.audits.some((a) => a.audit.ruleId === 'WC_REFERENCE_OPTIONAL_FOR_HISTORICAL_SALE')).toBe(
      true,
    );
  });

  it('6. current inventory required serial behavior', () => {
    expect(currentInventoryRequiresSerial(null)).toBe(false);
    expect(currentInventoryRequiresSerial('  ')).toBe(false);
    expect(currentInventoryRequiresSerial('ABC123')).toBe(true);
  });

  it('7. running balance not imported as movement', () => {
    expect(
      isRunningBalanceOnlyRow({
        entryAmount: null,
        exitAmount: null,
        reportedBalance: 1000,
      }),
    ).toBe(true);
    expect(
      isRunningBalanceOnlyRow({
        entryAmount: 100,
        exitAmount: null,
        reportedBalance: 1100,
      }),
    ).toBe(false);
  });

  it('8. bank 1% commission classified once', () => {
    expect(isBankOnePercentCommission({ deposit: 10000, withdrawal: 100, commission: null })).toBe(
      true,
    );
    expect(isBankOnePercentCommission({ deposit: 10000, withdrawal: 500, commission: null })).toBe(
      false,
    );
    expect(isBankOnePercentCommission({ deposit: null, withdrawal: null, commission: 50 })).toBe(
      true,
    );
  });

  it('9. summary rows excluded pattern — deferred crypto/oscar labels', () => {
    expect(isDeferredGroup('CRIPTO CESAR')).toBe(true);
    expect(isDeferredGroup('OSCAR PAPA CAMI')).toBe(true);
    expect(DEFERRED_SHEET_RULES.CRIPTO_CESAR.ruleId).toBe('WC_DEFER_CRYPTO_SHEET');
    expect(DEFERRED_SHEET_RULES.OSCAR_PAPA_CAMI.ruleId).toBe('WC_DEFER_OSCAR_SHEET');
  });

  it('10. exact normalized customer grouping', () => {
    expect(classifyCustomerNamePair('  Juan   Perez ', 'juan perez')).toBe(
      'exact_normalized_duplicate',
    );
  });

  it('11. fuzzy / typo customer remains review class', () => {
    expect(classifyCustomerNamePair('Juan Perez', 'Juan Peres')).toBe('possible_typo');
  });

  it('12. accent-only is review suggestion class not auto-merge key', () => {
    expect(classifyCustomerNamePair('Jose', 'José')).toBe('accent_only_variant');
  });

  it('13. repeated expense alias mapping', () => {
    expect(resolveExpenseCategory('Gasolina').category).toBe('GASOLINE');
    expect(resolveExpenseCategory('comisión jaziel').category).toBe('COMMISSIONS');
    expect(resolveExpenseCategory('pauta').category).toBe('MARKETING');
  });

  it('14. optional / unmapped category maps to OTHER not conflict', () => {
    const r = resolveExpenseCategory('ruben');
    expect(r.category).toBe('OTHER');
    expect(r.patch.disposition).toBe('CREATE');
    expect(r.patch.audit.ruleId).toBe('WC_EXPENSE_UNMAPPED_AS_OTHER');
  });

  it('15. deferred crypto rule id', () => {
    expect(DEFERRED_SHEET_RULES.CRIPTO_CESAR.ruleId).toBe('WC_DEFER_CRYPTO_SHEET');
  });

  it('16. deferred Oscar rule id', () => {
    expect(DEFERRED_SHEET_RULES.OSCAR_PAPA_CAMI.ruleId).toBe('WC_DEFER_OSCAR_SHEET');
  });

  it('17. 75/25 distribution validation', () => {
    expect(expectedProfitShare('CESAR')).toBe(0.75);
    expect(expectedProfitShare('EDGAR')).toBe(0.25);
    expect(isSupportedProfitPartner('CESAR')).toBe(true);
    expect(isSupportedProfitPartner('OSCAR')).toBe(false);
  });

  it('18. unclassified partner movement remains conflict when both amounts', () => {
    const r = classifyPartnerMovement({
      entryAmount: 100,
      exitAmount: 50,
      classification: 'UNCLASSIFIED',
    });
    expect(r.classification).toBe('UNCLASSIFIED');
    expect(r.patch).toBeNull();
  });

  it('19. partner entry/exit deterministic', () => {
    expect(
      classifyPartnerMovement({
        entryAmount: 100,
        exitAmount: null,
        classification: 'UNCLASSIFIED',
      }).classification,
    ).toBe('CONTRIBUTION');
    expect(
      classifyPartnerMovement({
        entryAmount: null,
        exitAmount: 40,
        classification: 'UNCLASSIFIED',
      }).classification,
    ).toBe('WITHDRAWAL');
  });

  it('20. expense label normalize', () => {
    expect(normalizeExpenseLabel('  Gas olina  ')).toBe('gas olina');
  });

  it('21. polluted serial nullified', () => {
    const r = applyHistoricalSaleFieldRules({ serial: 'dolares', reference: null });
    expect(r.serial).toBeNull();
    expect(r.audits.some((a) => a.audit.ruleId === 'WC_POLLUTED_SERIAL_AS_NULL')).toBe(true);
  });

  it('22. historical sale never mutates inventory flag in audit', () => {
    const r = applyHistoricalSaleFieldRules({ serial: 'X', reference: 'Y' });
    expect(r.audits.some((a) => a.audit.ruleId === 'WC_HISTORICAL_SALE_NO_CURRENT_WATCH')).toBe(
      true,
    );
  });
});
