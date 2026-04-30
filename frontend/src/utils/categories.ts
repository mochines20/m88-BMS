export interface SubCategoryItem {
  name: string;
  code?: string;
}

export interface SubCategory {
  name: string;
  code?: string;
  items?: SubCategoryItem[];
}

export interface MainCategory {
  name: string;
  code?: string;
  subcategories: (string | SubCategory)[];
}

// Category code lookup for searching
export const CATEGORY_CODES: Record<string, string> = {
  // Sales
  "Sales": "4790",
  // Cost of Goods Sold
  "Cost of Goods Sold": "",
  // Payroll
  "Payroll Expense Executive": "66001",
  "Payroll Expense Accounting": "66002",
  "Payroll Expense H.R.": "66003",
  "Payroll Expense Logistics": "66004",
  "Payroll Expense Planning": "66005",
  "Payroll Expense Purchasing": "66006",
  "Payroll Expense Costing": "66007",
  "Payroll Expense I.T.": "66008",
  "Payroll Expense OJT": "66009",
  "Payroll Expense Supply Chain": "660010",
  "Phil. Health Insurance": "66012",
  "Home Development Company": "66017",
  "Social Security Company": "6606",
  // HR - Advertising
  "Zoom": "6011",
  "LinkedIn": "6012",
  "Advertising Other": "6010",
  // HR - Meals
  "Birthday Celebrations": "6431",
  "Training Meal": "6432",
  "Valentine's Day Celebration": "6435",
  "Representation": "6437",
  "Meals and Entertainment - Other": "6430",
  // HR - Office Supplies
  "Office Stationery & Supplies": "6491",
  "Consumable & Pantry/Cleaning Supplies": "6492",
  "Tools & Equipment": "6493",
  "Fire Extinguisher": "6494",
  "Office Supplies Other (Furnitures)": "6490",
  // HR - Medical
  "Medical Expenses": "6501",
  // HR - Professional Fees
  "Professional Fees - Other": "6670",
  "BIR Compliance Service": "6678",
  "DOLE Establishment Report & 13t": "6680",
  "Filing of Annual GIS": "6681",
  "Fire Safety Inspection Certific": "6682",
  "Nominee Directors Service": "6685",
  "Notarization Fee": "6686",
  "Posted Transactions": "6690",
  "Posted Transactions Adjustment": "6691",
  // HR - Travel
  "Foreign Travel-Airline Expenses": "6845",
  "Foreign Travel-Hotel": "6846",
  "Local Travel-Airline Expenses": "6845",
  "Local Travel-Hotel": "6846",
  "Travel Expense - Other": "6840",
  // HR - Welfare
  "Seminar": "6901",
  "HMO Expenses": "6902",
  "Uniform": "6906",
  // Admin - Automobile
  "Automobile Fuel": "6021",
  "Parking Fee": "6022",
  "Toll Expense": "6023",
  "Automobile Repairs": "6024",
  "Car Insurance": "6026",
  "Automobile Expenses-Registration": "6020",
  // Admin - Insurance
  "Insurance Expense": "6330",
  // Admin - Postage
  "Postage and Delivery": "6650",
  // Admin - Rent
  "Office Rent Expense": "6711",
  // Admin - Repairs
  "Repairs and Maintenance": "6720",
  // Admin - Utilities
  "Electricity": "6861",
  "Globe": "6811",
  "Smart Bills": "6812",
  "PLDT Telephone": "6813",
  "Internet Subscription": "6814",
  "Utilities Others (Aircon etc)": "6860",
  // Accounting
  "Bank Service Charges": "6040",
  "Realized Forex Gain/Loss": "6041",
  "Depreciation Expense": "6240",
  "Interest Expense": "6340",
  "Sundry & Misc": "9900",
  "Business Tax/Licenses": "6351",
  "Income Tax": "6352",
  // IT
  "Computer and Internet Expenses": "6170"
};

// Get code for a category/item
export const getCategoryCode = (name: string): string | undefined => {
  return CATEGORY_CODES[name];
};

// Build searchable string with codes
export const buildCategorySearchString = (category: string): string => {
  const parts = category.split(' > ');
  const codes: string[] = [];
  
  parts.forEach(part => {
    const code = getCategoryCode(part.trim());
    if (code) codes.push(code);
  });
  
  return `${category} ${codes.join(' ')}`;
};

export const CATEGORY_STRUCTURE: MainCategory[] = [
  {
    name: "Sales",
    code: "4790",
    subcategories: ["Sales"]
  },
  {
    name: "Cost of Goods Sold",
    subcategories: ["Cost of Goods Sold"]
  },
  {
    name: "Payroll",
    subcategories: [
      { name: "Payroll Expense Executive", code: "66001" },
      { name: "Payroll Expense Accounting", code: "66002" },
      { name: "Payroll Expense H.R.", code: "66003" },
      { name: "Payroll Expense Logistics", code: "66004" },
      { name: "Payroll Expense Planning", code: "66005" },
      { name: "Payroll Expense Purchasing", code: "66006" },
      { name: "Payroll Expense Costing", code: "66007" },
      { name: "Payroll Expense I.T.", code: "66008" },
      { name: "Payroll Expense OJT", code: "66009" },
      { name: "Payroll Expense Supply Chain", code: "660010" },
      { name: "Phil. Health Insurance", code: "66012" },
      { name: "Home Development Company", code: "66017" },
      { name: "Social Security Company", code: "6606" }
    ]
  },
  {
    name: "HR",
    subcategories: [
      { 
        name: "Advertising and Promotion", 
        code: "6010",
        items: [
          { name: "Zoom", code: "6011" },
          { name: "LinkedIn", code: "6012" },
          { name: "Advertising Other", code: "6010" }
        ] 
      },
      { 
        name: "Meals and Entertainment", 
        code: "6430",
        items: [
          { name: "Birthday Celebrations", code: "6431" },
          { name: "Training Meal", code: "6432" },
          { name: "Valentine's Day Celebration", code: "6435" },
          { name: "Representation", code: "6437" },
          { name: "Meals and Entertainment - Other", code: "6430" }
        ] 
      },
      { 
        name: "Office Supplies", 
        code: "6490",
        items: [
          { name: "Office Stationery & Supplies", code: "6491" },
          { name: "Consumable & Pantry/Cleaning Supplies", code: "6492" },
          { name: "Tools & Equipment", code: "6493" },
          { name: "Fire Extinguisher", code: "6494" },
          { name: "Office Supplies Other (Furnitures)", code: "6490" }
        ] 
      },
      { 
        name: "Medical Records and Supplies", 
        code: "6500",
        items: [
          { name: "Medical Expenses", code: "6501" }
        ] 
      },
      { 
        name: "Professional Fees", 
        code: "6670",
        items: [
          { name: "Professional Fees - Other", code: "6670" },
          { name: "BIR Compliance Service", code: "6678" },
          { name: "DOLE Establishment Report & 13t", code: "6680" },
          { name: "Filing of Annual GIS", code: "6681" },
          { name: "Fire Safety Inspection Certific", code: "6682" },
          { name: "Nominee Directors Service", code: "6685" },
          { name: "Notarization Fee", code: "6686" },
          { name: "Posted Transactions", code: "6690" },
          { name: "Posted Transactions Adjustment", code: "6691" }
        ] 
      },
      { 
        name: "Travel Expense", 
        code: "6840",
        items: [
          { name: "Foreign Travel-Airline Expenses", code: "6845" },
          { name: "Foreign Travel-Hotel", code: "6846" },
          { name: "Local Travel-Airline Expenses", code: "6845" },
          { name: "Local Travel-Hotel", code: "6846" },
          { name: "Travel Expense - Other", code: "6840" },
          { name: "Travel Expenses - Indo Representative" }
        ] 
      },
      { 
        name: "Welfare - Employee", 
        code: "6900",
        items: [
          { name: "Seminar", code: "6901" },
          { name: "HMO Expenses", code: "6902" },
          { name: "Uniform", code: "6906" },
          { name: "Staff Welfare" }
        ] 
      }
    ]
  },
  {
    name: "Admin",
    subcategories: [
      { 
        name: "Automobile Expense", 
        code: "6020",
        items: [
          { name: "Automobile Fuel", code: "6021" },
          { name: "Parking Fee", code: "6022" },
          { name: "Toll Expense", code: "6023" },
          { name: "Automobile Repairs", code: "6024" },
          { name: "Car Insurance", code: "6026" },
          { name: "Automobile Expenses-Registration", code: "6020" }
        ] 
      },
      { 
        name: "Insurance Expense", 
        code: "6330",
        items: [
          { name: "Insurance Expense", code: "6330" }
        ] 
      },
      { 
        name: "Postage and Delivery", 
        code: "6650",
        items: [
          { name: "Postage and Delivery", code: "6650" }
        ] 
      },
      { 
        name: "Rent Expense", 
        code: "6710",
        items: [
          { name: "Office Rent Expense", code: "6711" }
        ] 
      },
      { 
        name: "Repairs and Maintenance", 
        code: "6720",
        items: [
          { name: "Repairs and Maintenance", code: "6720" }
        ] 
      },
      { 
        name: "Utilities", 
        code: "6860",
        items: [
          { name: "Electricity", code: "6861" },
          { name: "Globe", code: "6811" },
          { name: "Smart Bills", code: "6812" },
          { name: "PLDT Telephone", code: "6813" },
          { name: "Internet Subscription", code: "6814" },
          { name: "Utilities Others (Aircon etc)", code: "6860" }
        ] 
      }
    ]
  },
  {
    name: "Accounting",
    subcategories: [
      { 
        name: "Bank Service Charges", 
        code: "6040",
        items: [
          { name: "Bank Service Charges", code: "6040" }
        ] 
      },
      { 
        name: "Realized Forex Gain/Loss", 
        code: "6041",
        items: [
          { name: "Realized Forex Gain/Loss", code: "6041" }
        ] 
      },
      { 
        name: "Depreciation Expense", 
        code: "6240",
        items: [
          { name: "Depreciation Expense", code: "6240" }
        ] 
      },
      { 
        name: "Interest Expense", 
        code: "6340",
        items: [
          { name: "Interest Expense", code: "6340" }
        ] 
      },
      { 
        name: "Sundry", 
        code: "9900",
        items: [
          { name: "Sundry & Misc", code: "9900" }
        ] 
      },
      { 
        name: "Taxes & Licenses", 
        code: "6350",
        items: [
          { name: "Business Tax/Licenses", code: "6351" },
          { name: "Income Tax", code: "6352" }
        ] 
      }
    ]
  },
  {
    name: "IT",
    subcategories: [
      { 
        name: "Computer and Internet Expenses", 
        code: "6170",
        items: [
          { name: "Computer and Internet Expenses", code: "6170" }
        ] 
      }
    ]
  }
];
