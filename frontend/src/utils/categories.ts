export interface SubCategory {
  name: string;
  items?: string[];
}

export interface MainCategory {
  name: string;
  subcategories: (string | SubCategory)[];
}

export const CATEGORY_STRUCTURE: MainCategory[] = [
  {
    name: "Sales",
    subcategories: ["Sales"]
  },
  {
    name: "Cost of Goods Sold",
    subcategories: ["Cost of Goods Sold"]
  },
  {
    name: "Payroll",
    subcategories: [
      "Payroll Expense Executive",
      "Payroll Expense Accounting",
      "Payroll Expense H.R.",
      "Payroll Expense Logistics",
      "Payroll Expense Planning",
      "Payroll Expense Purchasing",
      "Payroll Expense Costing",
      "Payroll Expense I.T.",
      "Payroll Expense OJT",
      "Payroll Expense Supply Chain",
      "Phil. Health Insurance",
      "Home Development Company",
      "Social Security Company"
    ]
  },
  {
    name: "HR",
    subcategories: [
      { name: "Advertising and Promotion", items: ["Zoom", "LinkedIn", "Advertising Other"] },
      { name: "Meals and Entertainment", items: ["Birthday Celebrations", "Training Meal", "Valentine's Day Celebration", "Representation", "Meals and Entertainment - Other"] },
      { name: "Office Supplies", items: ["Office Stationery & Supplies", "Consumable & Pantry/Cleaning Supplies", "Tools & Equipment", "Fire Extinguisher", "Office Supplies Other (Furnitures)"] },
      { name: "Medical Records and Supplies", items: ["Medical Expenses"] },
      { name: "Professional Fees", items: ["Professional Fees - Other", "BIR Compliance Service", "DOLE Establishment Report & 13t", "Filing of Annual GIS", "Fire Safety Inspection Certific", "Nominee Directors Service", "Notarization Fee", "Posted Transactions", "Posted Transactions Adjustment"] },
      { name: "Travel Expense", items: ["Foreign Travel-Airline Expenses", "Foreign Travel-Hotel", "Local Travel-Airline Expenses", "Local Travel-Hotel", "Travel Expense - Other", "Travel Expenses - Indo Representative"] },
      { name: "Welfare - Employee", items: ["Seminar", "HMO Expenses", "Uniform", "Staff Welfare"] }
    ]
  },
  {
    name: "Admin",
    subcategories: [
      { name: "Automobile Expense", items: ["Automobile Fuel", "Parking Fee", "Toll Expense", "Automobile Repairs", "Car Insurance", "Automobile Expenses-Registration"] },
      { name: "Insurance Expense", items: ["Insurance Expense"] },
      { name: "Postage and Delivery", items: ["Postage and Delivery"] },
      { name: "Rent Expense", items: ["Office Rent Expense"] },
      { name: "Repairs and Maintenance", items: ["Repairs and Maintenance"] },
      { name: "Utilities", items: ["Electricity", "Globe", "Smart Bills", "PLDT Telephone", "Internet Subscription", "Utilities Others (Aircon etc)"] }
    ]
  },
  {
    name: "Accounting",
    subcategories: [
      { name: "Bank Service Charges", items: ["Bank Service Charges"] },
      { name: "Realized Forex Gain/Loss", items: ["Realized Forex Gain/Loss"] },
      { name: "Depreciation Expense", items: ["Depreciation Expense"] },
      { name: "Interest Expense", items: ["Interest Expense"] },
      { name: "Sundry", items: ["Sundry & Misc"] },
      { name: "Taxes & Licenses", items: ["Business Tax/Licenses", "Income Tax"] }
    ]
  },
  {
    name: "IT",
    subcategories: [
      { name: "Computer and Internet Expenses", items: ["Computer and Internet Expenses"] }
    ]
  }
];
