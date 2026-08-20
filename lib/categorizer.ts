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

export function categorizeVendor(rawDescription: string): {
  cleanVendor: string;
  category: ExpenseCategory;
  taxDeductible: boolean;
} {
  const normalized = rawDescription.toLowerCase();

  for (const rule of VENDOR_RULES) {
    if (rule.keywords.some((kw) => normalized.includes(kw))) {
      return {
        cleanVendor: rule.cleanName,
        category: rule.category,
        taxDeductible: rule.defaultTaxDeductible,
      };
    }
  }

  // Fallback heuristic
  let fallbackCategory: ExpenseCategory = 'overhead';
  if (normalized.includes('hardware') || normalized.includes('supply') || normalized.includes('lumber') || normalized.includes('tile')) {
    fallbackCategory = 'materials';
  } else if (normalized.includes('gas') || normalized.includes('oil') || normalized.includes('fuel')) {
    fallbackCategory = 'mileage_fuel';
  }

  return {
    cleanVendor: rawDescription.trim(),
    category: fallbackCategory,
    taxDeductible: true,
  };
}
