import { describe, expect, it } from 'vitest';
import { categorizeVendor } from '../src/categorizer';

// CHARACTERIZATION: pins the behaviour of the extracted prototype categorizer
// before any change. Matching is a plain case-insensitive substring test, so
// short keywords fire on fragments of unrelated words.

describe('categorizeVendor (characterization)', () => {
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

  // The defect this task fixes: 'bp' is a 2-character substring rule.
  it('BUG: the 2-char fuel keyword "bp" matches inside unrelated words', () => {
    expect(categorizeVendor('BPS PLUMBING SUPPLY CO').category).toBe('mileage_fuel');
    expect(categorizeVendor('SUBPAR CONTRACTING LLC').category).toBe('mileage_fuel');
  });

  // Same defect class in the fallback heuristic.
  it('BUG: the fallback keyword "oil" matches inside unrelated words', () => {
    expect(categorizeVendor('TOILET OUTLET WAREHOUSE').category).toBe('mileage_fuel');
  });
});
