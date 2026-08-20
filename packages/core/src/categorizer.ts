import { ExpenseCategory } from './types';

interface VendorRule {
  keywords: string[];
  category: ExpenseCategory;
  cleanName: string;
  defaultTaxDeductible: boolean;
}

const VENDOR_RULES: VendorRule[] = [
  // Materials / Supplies
  {
    keywords: ['home depot', 'the home depot', 'homedepot'],
    category: 'materials',
    cleanName: 'The Home Depot',
    defaultTaxDeductible: true,
  },
  {
    keywords: ["lowe's", 'lowes', 'lowes.com'],
    category: 'materials',
    cleanName: "Lowe's Home Improvement",
    defaultTaxDeductible: true,
  },
  {
    keywords: ['menards'],
    category: 'materials',
    cleanName: 'Menards',
    defaultTaxDeductible: true,
  },
  {
    keywords: ['ace hardware', 'ace hdwe'],
    category: 'materials',
    cleanName: 'Ace Hardware',
    defaultTaxDeductible: true,
  },
  {
    keywords: ['sherwin-williams', 'sherwin williams', 'sherwin'],
    category: 'materials',
    cleanName: 'Sherwin-Williams Paints',
    defaultTaxDeductible: true,
  },
  {
    keywords: ['ferguson', 'ferguson plumbing'],
    category: 'materials',
    cleanName: 'Ferguson Plumbing Supply',
    defaultTaxDeductible: true,
  },
  {
    keywords: ['floor & decor', 'floor and decor'],
    category: 'materials',
    cleanName: 'Floor & Decor',
    defaultTaxDeductible: true,
  },
  {
    keywords: ['84 lumber', 'build club', 'fastenal', 'grainger', 'mcmaster'],
    category: 'materials',
    cleanName: 'Trade Supply Depot',
    defaultTaxDeductible: true,
  },

  // Tools & Equipment
  {
    keywords: ['harbor freight', 'harbor freight tools'],
    category: 'tools',
    cleanName: 'Harbor Freight Tools',
    defaultTaxDeductible: true,
  },
  {
    keywords: ['sunbelt rentals', 'united rentals', 'tool rental'],
    category: 'tools',
    cleanName: 'Equipment Rental & Tools',
    defaultTaxDeductible: true,
  },

  // Mileage & Fuel
  {
    keywords: ['shell', 'chevron', 'exxon', 'mobil', 'bp', 'texaco', '76 station', 'wawa', 'circle k', 'speedway', 'pilot flying'],
    category: 'mileage_fuel',
    cleanName: 'Fuel & Vehicle Transit',
    defaultTaxDeductible: true,
  },
  {
    keywords: ['autozone', "o'reilly", 'advance auto', 'jiffy lube'],
    category: 'mileage_fuel',
    cleanName: 'Work Van Maintenance',
    defaultTaxDeductible: true,
  },

  // Permits & Fees / Waste Disposal
  {
    keywords: ['waste management', 'wm disposal', 'city permit', 'dump fee', 'transfer station', 'rubbish'],
    category: 'permits_fees',
    cleanName: 'Permit & Disposal Fees',
    defaultTaxDeductible: true,
  },

  // Overhead & Admin
  {
    keywords: ['quickbooks', 'intuit', 'godaddy', 'squarespace', 'google workspace', 'microsoft 365', 'staples', 'office depot'],
    category: 'overhead',
    cleanName: 'Office & Software Subscriptions',
    defaultTaxDeductible: true,
  },
];

// Bank descriptors glue the merchant name to store numbers and punctuation
// ("BP #4471 UNLEADED"), so keywords are matched as whole words rather than as
// bare substrings. Without this, two-character rules like 'bp' fire on
// "SUBPAR" and "BPS PLUMBING", and the fallback's 'oil' fires on "TOILET".
// The rules above stay plain data; only this matcher knows about boundaries.
function matchesKeyword(normalized: string, keyword: string): boolean {
  return keywordPattern(keyword).test(normalized);
}

const patternCache = new Map<string, RegExp>();

function keywordPattern(keyword: string): RegExp {
  let pattern = patternCache.get(keyword);
  if (!pattern) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`);
    patternCache.set(keyword, pattern);
  }
  return pattern;
}

export function categorizeVendor(rawDescription: string): {
  cleanVendor: string;
  category: ExpenseCategory;
  taxDeductible: boolean;
} {
  const normalized = rawDescription.toLowerCase();

  for (const rule of VENDOR_RULES) {
    if (rule.keywords.some((kw) => matchesKeyword(normalized, kw))) {
      return {
        cleanVendor: rule.cleanName,
        category: rule.category,
        taxDeductible: rule.defaultTaxDeductible,
      };
    }
  }

  // Fallback heuristic
  const matches = (kw: string) => matchesKeyword(normalized, kw);
  let fallbackCategory: ExpenseCategory = 'overhead';
  if (['hardware', 'supply', 'lumber', 'tile'].some(matches)) {
    fallbackCategory = 'materials';
  } else if (['gas', 'oil', 'fuel'].some(matches)) {
    fallbackCategory = 'mileage_fuel';
  }

  return {
    cleanVendor: rawDescription.trim(),
    category: fallbackCategory,
    taxDeductible: true,
  };
}
