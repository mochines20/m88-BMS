import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney, toNumber , getErrorMessage } from '../utils/format';

interface Department {
  id: string;
  name: string;
  fiscal_year: number;
}

interface BudgetCategory {
  id?: string;
  category_code: string;
  category_name: string;
  budget_amount: number;
}

const BudgetSetup = () => {
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [fiscalYear, setFiscalYear] = useState<number>(new Date().getFullYear());
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletedCategoryIds, setDeletedCategoryIds] = useState<string[]>([]);

  const DEPARTMENT_DEFAULTS: Record<string, BudgetCategory[]> = {
    'Accounting': [
      { category_code: '6040', category_name: 'Bank Service Charges', budget_amount: 0 },
      { category_code: '6041', category_name: 'Realized Forex Gain/Loss', budget_amount: 0 },
      { category_code: '6240', category_name: 'Depreciation Expense', budget_amount: 0 },
      { category_code: '6340', category_name: 'Interest Expense', budget_amount: 0 },
      { category_code: '6351', category_name: 'Taxes & Licenses (6351)', budget_amount: 0 },
      { category_code: '6352', category_name: 'Taxes & Licenses (6352)', budget_amount: 0 },
      { category_code: '9900', category_name: 'Sundry', budget_amount: 0 },
    ],
    'Finance': [
      { category_code: '6040', category_name: 'Bank Service Charges', budget_amount: 0 },
      { category_code: '6041', category_name: 'Realized Forex Gain/Loss', budget_amount: 0 },
      { category_code: '6240', category_name: 'Depreciation Expense', budget_amount: 0 },
      { category_code: '6340', category_name: 'Interest Expense', budget_amount: 0 },
      { category_code: '6351', category_name: 'Taxes & Licenses (6351)', budget_amount: 0 },
      { category_code: '6352', category_name: 'Taxes & Licenses (6352)', budget_amount: 0 },
      { category_code: '9900', category_name: 'Sundry', budget_amount: 0 },
    ],
    'Admin': [
      { category_code: '6020', category_name: 'Automobile Expense (6020)', budget_amount: 0 },
      { category_code: '6021', category_name: 'Automobile Expense (6021)', budget_amount: 0 },
      { category_code: '6022', category_name: 'Automobile Expense (6022)', budget_amount: 0 },
      { category_code: '6023', category_name: 'Automobile Expense (6023)', budget_amount: 0 },
      { category_code: '6024', category_name: 'Automobile Expense (6024)', budget_amount: 0 },
      { category_code: '6026', category_name: 'Automobile Expense (6026)', budget_amount: 0 },
      { category_code: '6330', category_name: 'Insurance Expense', budget_amount: 0 },
      { category_code: '6650', category_name: 'Postage and Delivery', budget_amount: 0 },
      { category_code: '6711', category_name: 'Rent Expense', budget_amount: 0 },
      { category_code: '6720', category_name: 'Repairs and Maintenance', budget_amount: 0 },
      { category_code: '6860', category_name: 'Utilities (6860)', budget_amount: 0 },
      { category_code: '6861', category_name: 'Utilities (6861)', budget_amount: 0 },
      { category_code: '6811', category_name: 'Utilities (6811)', budget_amount: 0 },
      { category_code: '6812', category_name: 'Utilities (6812)', budget_amount: 0 },
      { category_code: '6813', category_name: 'Utilities (6813)', budget_amount: 0 },
      { category_code: '6814', category_name: 'Utilities (6814)', budget_amount: 0 },
    ],
    'Cost of Goods Sold': [
      { category_code: '66001', category_name: 'Payroll - Executive', budget_amount: 0 },
      { category_code: '66002', category_name: 'Payroll - Accounting', budget_amount: 0 },
      { category_code: '66003', category_name: 'Payroll - H.R.', budget_amount: 0 },
      { category_code: '66004', category_name: 'Payroll - Logistics', budget_amount: 0 },
      { category_code: '66005', category_name: 'Payroll - Planning', budget_amount: 0 },
      { category_code: '66006', category_name: 'Payroll - Purchasing', budget_amount: 0 },
      { category_code: '66007', category_name: 'Payroll - Costing', budget_amount: 0 },
      { category_code: '66008', category_name: 'Payroll - I.T.', budget_amount: 0 },
      { category_code: '66009', category_name: 'Payroll - OJT', budget_amount: 0 },
      { category_code: '660010', category_name: 'Payroll - Supply Chain', budget_amount: 0 },
      { category_code: '66012', category_name: 'PhilHealth Insurance', budget_amount: 0 },
      { category_code: '66017', category_name: 'Pag-IBIG (Home Dev\'t)', budget_amount: 0 },
      { category_code: '6606', category_name: 'SSS (Social Security)', budget_amount: 0 },
    ],
    'Logistics': [
      { category_code: '6020', category_name: 'Logistics - Vehicle Rental', budget_amount: 0 },
      { category_code: '6021', category_name: 'Logistics - Fuel & Oil', budget_amount: 0 },
      { category_code: '6650', category_name: 'Freight and Shipping', budget_amount: 0 },
      { category_code: '6720', category_name: 'Warehouse Repairs', budget_amount: 0 },
      { category_code: '6860', category_name: 'Warehouse Utilities', budget_amount: 0 },
    ],
    'Operations': [
      { category_code: 'OPS-1', category_name: 'Production Supplies', budget_amount: 0 },
      { category_code: 'OPS-2', category_name: 'Equipment Maintenance', budget_amount: 0 },
      { category_code: 'OPS-3', category_name: 'Direct Labor Overtime', budget_amount: 0 },
    ],
    'Purchasing': [
      { category_code: 'PUR-1', category_name: 'Vendor Evaluation Costs', budget_amount: 0 },
      { category_code: 'PUR-2', category_name: 'Procurement Systems', budget_amount: 0 },
    ],
    'Planning': [
      { category_code: 'PLN-1', category_name: 'Market Research', budget_amount: 0 },
      { category_code: 'PLN-2', category_name: 'Strategic Consulting', budget_amount: 0 },
    ],
    'HR': [
      { category_code: '6010', category_name: 'Advertising and Promotion (6010)', budget_amount: 0 },
      { category_code: '6430', category_name: 'Meals and Entertainment (6430)', budget_amount: 0 },
      { category_code: '6490', category_name: 'Office Supplies (6490)', budget_amount: 0 },
      { category_code: '6501', category_name: 'Medical Records and Supplies', budget_amount: 0 },
      { category_code: '6670', category_name: 'Professional Fees (6670)', budget_amount: 0 },
      { category_code: '6840', category_name: 'Travel Expense (6840)', budget_amount: 0 },
      { category_code: '6900', category_name: 'Welfare - Employee (6900)', budget_amount: 0 },
    ],
    'IT': [
      { category_code: '6170', category_name: 'Computer and Internet Expenses', budget_amount: 0 },
    ],
    'Sales': [
      { category_code: '4790', category_name: 'Sales Commission & Promo', budget_amount: 0 },
    ]
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const loadDepartments = async () => {
      try {
        const res = await api.get('/api/departments', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setDepartments(res.data || []);
        if (res.data?.length > 0) {
          setSelectedDept(res.data[0].id);
          setFiscalYear(res.data[0].fiscal_year || new Date().getFullYear());
        }
      } catch (err: any) {
        toast.error('Failed to load departments');
      } finally {
        setLoading(false);
      }
    };

    loadDepartments();
  }, [navigate]);

  useEffect(() => {
    if (!selectedDept) return;

    const loadExistingCategories = async () => {
      const token = localStorage.getItem('token');
      try {
        const res = await api.get(`/api/budget/categories?department_id=${selectedDept}&fiscal_year=${fiscalYear}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.data?.length > 0) {
          // Use existing categories
          setCategories(res.data.map((cat: any) => ({
            id: cat.id,
            category_code: cat.category_code,
            category_name: cat.category_name,
            budget_amount: Number(cat.budget_amount)
          })));
        } else {
          // Use department-specific default categories
          const dept = departments.find(d => d.id === selectedDept);
          const deptName = dept?.name || '';

          // Try exact match, then case-insensitive, then fallback to empty
          // Try exact match, then fuzzy match (contains), then fallback
          let defaults: BudgetCategory[] = [];
          const exactMatch = DEPARTMENT_DEFAULTS[deptName];
          if (exactMatch) {
            defaults = exactMatch;
          } else {
            const entry = Object.entries(DEPARTMENT_DEFAULTS).find(
              ([name]) => deptName.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(deptName.toLowerCase())
            );
            defaults = entry ? entry[1] : [];
          }

          setCategories(defaults.map(c => ({ ...c })));
        }
      } catch {
        setCategories([]);
      }
    };

    loadExistingCategories();
  }, [selectedDept, fiscalYear, departments]);

  const handleCategoryChange = (index: number, field: keyof BudgetCategory, value: string | number) => {
    setCategories(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addCategory = () => {
    setCategories(prev => [
      ...prev,
      { category_code: '', category_name: '', budget_amount: 0 }
    ]);
  };

  const removeCategory = (index: number) => {
    const category = categories[index];
    if (category.id) {
      setDeletedCategoryIds(prev => [...prev, category.id!]);
    }
    setCategories(prev => prev.filter((_, i) => i !== index));
  };

  const handleResetToDefaults = () => {
    const dept = departments.find(d => d.id === selectedDept);
    const deptName = dept?.name || '';

    let defaults: BudgetCategory[] = [];
    const exactMatch = DEPARTMENT_DEFAULTS[deptName];
    if (exactMatch) {
      defaults = exactMatch;
    } else {
      const entry = Object.entries(DEPARTMENT_DEFAULTS).find(
        ([name]) => deptName.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(deptName.toLowerCase())
      );
      defaults = entry ? entry[1] : [];
    }

    if (defaults.length === 0) {
      toast.error(`No standard defaults found for "${deptName}".`);
      return;
    }

    if (window.confirm(`Are you sure you want to reset to defaults for ${deptName}? This will mark all current categories for deletion upon saving.`)) {
      // Mark all existing categories for deletion
      const currentIds = categories.filter(c => c.id).map(c => c.id!);
      setDeletedCategoryIds(prev => Array.from(new Set([...prev, ...currentIds])));

      // Load defaults
      setCategories(defaults.map(c => ({ ...c })));
      toast.success('Defaults loaded. Click "Save" to apply changes.');
    }
  };

  const totalBudget = categories.reduce((sum, cat) => sum + toNumber(cat.budget_amount), 0);

  const handleSave = async () => {
    // Validation
    const invalidCategories = categories.filter(
      cat => !cat.category_code || !cat.category_name || cat.budget_amount < 0
    );

    if (invalidCategories.length > 0) {
      toast.error('Please fill in all category codes, names, and valid amounts');
      return;
    }

    setSaving(true);
    const token = localStorage.getItem('token');

    try {
      // For existing categories, update them. For new ones, create them.
      const savePromises = categories.map(cat => {
        if (cat.id) {
          // Update existing
          return api.put(`/api/budget/categories/${cat.id}`, {
            budget_amount: cat.budget_amount,
            category_name: cat.category_name
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
        } else {
          // Create new
          return api.post('/api/budget/categories', {
            department_id: selectedDept,
            fiscal_year: fiscalYear,
            category_code: cat.category_code,
            category_name: cat.category_name,
            budget_amount: cat.budget_amount
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
        }
      });

      // Handle deletions
      const deletePromises = deletedCategoryIds.map(id =>
        api.delete(`/api/budget/categories/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      );

      await Promise.all([...savePromises, ...deletePromises]);
      setDeletedCategoryIds([]); // Reset deletions state after successful save
      toast.success('Budget setup saved successfully!');

      // Reload categories
      const res = await api.get(`/api/budget/categories?department_id=${selectedDept}&fiscal_year=${fiscalYear}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCategories(res.data.map((cat: any) => ({
        id: cat.id,
        category_code: cat.category_code,
        category_name: cat.category_name,
        budget_amount: Number(cat.budget_amount)
      })));
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to save budget setup'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="bms-spinner"></div>
      </div>
    );
  }

  const selectedDepartment = departments.find(d => d.id === selectedDept);

  return (
    <div className="text-[var(--role-text)] page-transition">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Budget Setup</h1>
        <p className="page-subtitle">Create and maintain department budgets by category</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Selection */}
        <div className="panel">
          <h2 className="text-lg font-semibold mb-4">Select Department</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Department</label>
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              >
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Fiscal Year</label>
              <input
                type="number"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(parseInt(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              />
            </div>

            {selectedDepartment && (
              <div className="p-4 rounded-xl bg-[var(--role-accent)]/50 border border-[var(--role-border)]">
                <p className="text-sm text-[var(--role-text)]/60">Selected</p>
                <p className="font-semibold">{selectedDepartment.name}</p>
                <p className="text-sm">FY {fiscalYear}</p>
              </div>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-[var(--role-border)]">
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Budget Summary
            </h3>

            {/* Category Breakdown */}
            <div className="space-y-1 mb-3 max-h-48 overflow-y-auto">
              {categories.map((cat, idx) => (
                <div key={idx} className="flex justify-between text-sm py-1.5 px-2 rounded-lg hover:bg-[var(--role-accent)]/50">
                  <span className="text-[var(--role-text)]/70 truncate" title={cat.category_name}>
                    {cat.category_code || 'UNCAT'}
                  </span>
                  <span className="font-medium text-emerald-600">{formatMoney(cat.budget_amount)}</span>
                </div>
              ))}
              {categories.length === 0 && (
                <p className="text-sm text-[var(--role-text)]/40 italic py-2">No categories added</p>
              )}
            </div>

            {/* Total */}
            <div className="pt-3 border-t border-[var(--role-border)]">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-[var(--role-text)]">Total Budget</span>
                <span className="text-lg font-bold text-emerald-600">{formatMoney(totalBudget)}</span>
              </div>
              <p className="text-xs text-[var(--role-text)]/50 mt-1">
                {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} defined
              </p>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full mt-6 btn-primary py-3"
          >
            {saving ? 'Saving...' : 'Save Budget Setup'}
          </button>
        </div>

        {/* Right Panel - Categories */}
        <div className="panel lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Budget Categories</h2>
            <div className="flex gap-2">
              <button
                onClick={handleResetToDefaults}
                className="btn-secondary text-sm flex items-center gap-2 border-orange-200 text-orange-600 hover:bg-orange-50"
                title="Reset to department-specific standard categories"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reset to Defaults
              </button>
              <button
                onClick={addCategory}
                className="btn-secondary text-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Category
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {categories.map((category, index) => (
              <div
                key={index}
                className="grid grid-cols-12 gap-3 items-start p-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)]/30"
              >
                <div className="col-span-3">
                  <label className="block text-xs text-[var(--role-text)]/60 mb-1">Category Code</label>
                  <input
                    type="text"
                    value={category.category_code}
                    onChange={(e) => handleCategoryChange(index, 'category_code', e.target.value.toUpperCase())}
                    placeholder="e.g., TRAVEL"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                  />
                </div>
                <div className="col-span-5">
                  <label className="block text-xs text-[var(--role-text)]/60 mb-1">Category Name</label>
                  <input
                    type="text"
                    value={category.category_name}
                    onChange={(e) => handleCategoryChange(index, 'category_name', e.target.value)}
                    placeholder="e.g., Travel & Transport"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-[var(--role-text)]/60 mb-1">Budget Amount</label>
                  <input
                    type="number"
                    value={category.budget_amount}
                    onChange={(e) => handleCategoryChange(index, 'budget_amount', parseFloat(e.target.value) || 0)}
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    onClick={() => removeCategory(index)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove category"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {categories.length === 0 && (
            <div className="text-center py-8 text-[var(--role-text)]/60">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p>No categories defined</p>
              <button onClick={addCategory} className="mt-2 text-[var(--role-primary)] hover:underline">
                Add your first category
              </button>
            </div>
          )}

          {/* Cost Center Section */}
          <div className="mt-8 pt-8 border-t border-[var(--role-border)]">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-[var(--role-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Cost Centers
            </h3>
            <p className="text-sm text-[var(--role-text)]/60 mb-4">
              Cost centers help track expenses within departments. Contact your admin to manage cost centers.
            </p>
            <button
              onClick={() => navigate('/admin')}
              className="btn-secondary text-sm"
            >
              Manage Cost Centers →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BudgetSetup;
