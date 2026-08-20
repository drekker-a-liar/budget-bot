import { describe, expect, it } from 'vitest';
import { categorizeVendor } from '../src/categorizer';

// CHARACTERIZATION of the rule table, except where a test is marked CHANGED:
// matching used to be a plain case-insensitive substring test, so short
// keywords fired on fragments of unrelated words.

describe('categorizeVendor', () => {
  const cases: Array<[string, string, string, boolean]> = [
    // descriptor, cleanVendor, category, taxDeductible
    ['THE HOME DEPOT #0421 - Schluter Kerdi Pan', 'The Home Depot', 'materials', true],
    ["LOWE'S #1104 - 2x8 Pressure Treated Joists", "Lowe's Home Improvement", 'materials', true],
    ['FLOOR & DECOR - Carrara White Porcelain', 'Floor & Decor', 'materials', true],
    ['FERGUSON PLUMBING - Uponor PEX-A Tubing', 'Ferguson Plumbing Supply', 'materials', true],
    ['SHERWIN-WILLIAMS - SuperDeck Cedar Tone', 'Sherwin-Williams Paints', 'materials', true],
    ['FASTENAL - GRK Deck Elite Screws', 'Trade Supply Depot', 'materials', true],
    ['HARBOR FREIGHT TOOLS - Bauer 20V Router', 'Harbor Freight Tools', 'tools', true],
    ['SHELL OIL 5742 - Regular Unleaded', 'Fuel & Vehicle Transit', 'mileage_fuel', true],
    ['CHEVRON 0921 - Unleaded Fuel Work Van', 'Fuel & Vehicle Transit', 'mileage_fuel', true],
    ['WASTE MANAGEMENT - 10-Yard Roll-Off', 'Permit & Disposal Fees', 'permits_fees', true],
    ['QUICKBOOKS ONLINE SUBSCRIPTION', 'Office & Software Subscriptions', 'overhead', true],
  ];

  it.each(cases)('%s -> %s / %s', (descriptor, cleanVendor, category, taxDeductible) => {
    expect(categorizeVendor(descriptor)).toEqual({ cleanVendor, category, taxDeductible });
  });

  it('falls back to the raw descriptor and a keyword-guessed category', () => {
    expect(categorizeVendor('  RIVERSIDE TILE WORKS  ')).toEqual({
      cleanVendor: 'RIVERSIDE TILE WORKS',
      category: 'materials',
      taxDeductible: true,
    });
    expect(categorizeVendor('UNKNOWN MERCHANT 991')).toEqual({
      cleanVendor: 'UNKNOWN MERCHANT 991',
      category: 'overhead',
      taxDeductible: true,
    });
  });

  // CHANGED: keywords now have to sit on a word boundary. The rule table is
  // untouched data; only the matcher that reads it got stricter.
  it.each([
    // descriptor, category before the change, category after
    ['BPS PLUMBING SUPPLY CO', 'mileage_fuel', 'materials'],
    ['SUBPAR CONTRACTING LLC', 'mileage_fuel', 'overhead'],
    ['MOBILE PHONE STORE 44', 'mileage_fuel', 'overhead'],
  ])(
    'CHANGED: %s is no longer %s, because the keyword sat mid-word',
    (descriptor, _before, after) => {
      expect(categorizeVendor(descriptor).category).toBe(after);
    }
  );

  it('CHANGED: the fallback keyword "oil" no longer matches inside "TOILET"', () => {
    expect(categorizeVendor('TOILET OUTLET WAREHOUSE').category).toBe('overhead');
  });

  it('still matches those same keywords when they stand alone', () => {
    expect(categorizeVendor('BP #4471 UNLEADED').category).toBe('mileage_fuel');
    expect(categorizeVendor('MOBIL 0392 FUEL').category).toBe('mileage_fuel');
    expect(categorizeVendor('BULK MOTOR OIL DRUM').category).toBe('mileage_fuel');
  });
});
