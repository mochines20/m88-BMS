import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney , getErrorMessage } from '../utils/format';

type RequestType = 'reimbursement' | 'cash_advance' | 'liquidation';

interface Category {
  id: string;
  category_code: string;
  category_name: string;
  department_id: string;
  budget_amount?: number;
  allocated_amount?: number;
  remaining_amount?: number;
}

interface CostCenter {
  id: string;
  cost_center_code: string;
  cost_center_name: string;
}

interface CashAdvance {
  id: string;
  advance_code: string;
  amount_issued: number;
  balance: number;
  purpose: string;
}

interface OfficialExpense {
  code: string;
  itemName: string;
  category: string;
  dept: string | string[];
  canCA: boolean;
  canRE: boolean;
}

interface LiquidationItem {
  expense_date: string;
  category_id: string;
  main_category: string;
  description: string;
  amount: number;
  receipt_attached: boolean;
}

const NewRequestForm = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialType = (searchParams.get('type') as RequestType) || 'reimbursement';
  const initialAdvanceId = searchParams.get('advance_id');

  const [activeTab, setActiveTab] = useState<RequestType>(() => {
    const saved = localStorage.getItem('active_request_tab');
    if (saved) return saved as RequestType;
    return initialType;
  });
  const [user, setUser] = useState<any>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [cashAdvances, setCashAdvances] = useState<CashAdvance[]>([]);
  const [officialList, setOfficialList] = useState<OfficialExpense[]>([]);
  const [selectedAdvance, setSelectedAdvance] = useState<CashAdvance | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Selected main categories for hierarchical dropdowns
  const [cashAdvanceMainCategory, setCashAdvanceMainCategory] = useState('');

  // Helper: Get unique main categories from official list
  const getUniqueMainCategories = () => {
    const categories = new Set<string>();
    officialList.forEach(item => {
      if (item.category) categories.add(item.category);
    });
    return Array.from(categories).sort();
  };

  // Helper: Filter items by main category
  const getItemsByMainCategory = (mainCategory: string, canUse: 'canRE' | 'canCA') => {
    // For liquidations, don't filter by approved expense items
    if (canUse === 'canRE') return [];
    return officialList.filter(item => 
      item.category === mainCategory && 
      item[canUse] === true
    );
  };

  const uploadSupportingFile = async (file: File) => {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Not authenticated');
    }

    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post('/api/upload', formData, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    return response.data;
  };

  // Reimbursement Form
  const [reimbursementForm, setReimbursementForm] = useState({
    expense_date: new Date().toISOString().split('T')[0],
    department_id: '',
    cost_center_id: '',
    project: '',
    business_purpose: '',
    receipt_files: [] as File[],
    items: [
      { main_category: '', item_name: '', category_id: '', amount: '' }
    ] as Array<{
      main_category: string;
      item_name: string;
      category_id: string;
      amount: string;
    }>
  });

  // Cash Advance Form
  const [cashAdvanceForm, setCashAdvanceForm] = useState({
    advance_type: 'Travel',
    department_id: '',
    main_category: '',
    item_name: '',
    amount: '',
    expected_use_date: '',
    expected_liquidation_date: '',
    purpose: '',
    cost_center_id: '',
    breakdown: [
      { item: 'Transportation', amount: '' },
      { item: 'Meals', amount: '' },
      { item: 'Miscellaneous', amount: '' }
    ],
    attachments: [] as File[]
  });

  // Liquidation Form
  const [liquidationForm, setLiquidationForm] = useState({
    advance_id: initialAdvanceId || '',
    items: [] as LiquidationItem[],
    attachments: [] as File[]
  });

  // Load drafts on mount
  useEffect(() => {
    const rDraft = localStorage.getItem('reimbursement_draft');
    if (rDraft) {
      try {
        const parsed = JSON.parse(rDraft);
        console.log('Restoring reimbursement draft:', parsed);
        setReimbursementForm((prev: any) => ({ ...prev, ...parsed, receipt_files: [] }));
        // Don't toast here, wait until loadData confirms it's still valid
      } catch (e) { console.error('Failed to parse reimbursement draft'); }
    }

    const cDraft = localStorage.getItem('cash_advance_draft');
    if (cDraft) {
      try {
        const parsed = JSON.parse(cDraft);
        console.log('Restoring cash advance draft:', parsed);
        setCashAdvanceForm((prev: any) => ({ ...prev, ...parsed, attachments: [] }));
      } catch (e) { console.error('Failed to parse cash advance draft'); }
    }

    const lDraft = localStorage.getItem('liquidation_draft');
    if (lDraft) {
      try {
        const parsed = JSON.parse(lDraft);
        console.log('Restoring liquidation draft:', parsed);
        setLiquidationForm((prev: any) => ({ ...prev, ...parsed, attachments: [] }));
      } catch (e) { console.error('Failed to parse liquidation draft'); }
    }
  }, []);

  // Save drafts when forms change
  useEffect(() => {
    // Save whenever there is substantial content
    const hasContent = reimbursementForm.items.some(i => i.item_name && i.amount) || reimbursementForm.business_purpose;
    if (hasContent) {
      console.log('Saving reimbursement draft...');
      const { receipt_files, ...rest } = reimbursementForm;
      localStorage.setItem('reimbursement_draft', JSON.stringify(rest));
    }
  }, [reimbursementForm]);

  useEffect(() => {
    // Save whenever there is ANY user input in crucial fields
    const hasAnyContent = 
      cashAdvanceForm.purpose.length > 0 || 
      cashAdvanceForm.expected_use_date || 
      cashAdvanceForm.breakdown.some(i => i.amount && i.amount !== '0' && i.amount !== '') ||
      cashAdvanceForm.department_id !== '';
    
    if (hasAnyContent) {
      console.log('--- SAVING CASH ADVANCE DRAFT ---', cashAdvanceForm);
      const { attachments, ...rest } = cashAdvanceForm;
      localStorage.setItem('cash_advance_draft', JSON.stringify(rest));
    }
  }, [cashAdvanceForm]);

  useEffect(() => {
    const hasItems = liquidationForm.items.length > 0 && liquidationForm.items.some((i: LiquidationItem) => i.amount > 0 || i.description.trim().length > 0);
    if (hasItems) {
      console.log('Saving liquidation draft...');
      const { attachments, ...rest } = liquidationForm;
      localStorage.setItem('liquidation_draft', JSON.stringify(rest));
    }
  }, [liquidationForm]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const loadData = async () => {
      try {
        // First get user data
        const userRes = await api.get('/api/auth/me');
        const userData = userRes.data;
        setUser(userData);

        // Fetch departments, categories and cost centers (filtered by user's department and fiscal year)
        const currentFiscalYear = userData.fiscal_year || new Date().getFullYear();
        const [departmentsRes, categoriesRes, costCentersRes] = await Promise.all([
          api.get('/api/departments'),
          api.get(`/api/budget/categories?department_id=${userData.department_id || ''}&fiscal_year=${currentFiscalYear}`),
          api.get(`/api/budget/cost-centers?department_id=${userData.department_id || ''}`)
        ]);

        setDepartments(departmentsRes.data || []);
        // Only show categories that belong to the user's department
        setCategories(categoriesRes.data || []);
        setCostCenters(costCentersRes.data || []);

        // Load cash advances for liquidation
        const advancesRes = await api.get(`/api/cash-advances/for-liquidation/${userRes.data.id}`);
        setCashAdvances(advancesRes.data || []);

        // Load official expense list
        const officialRes = await api.get('/api/requests/official-list');
        setOfficialList(officialRes.data || []);

        // If initial advance_id provided, select it
        if (initialAdvanceId) {
          const advance = advancesRes.data?.find((a: CashAdvance) => a.id === initialAdvanceId);
          if (advance) {
            setSelectedAdvance(advance);
            setLiquidationForm(prev => ({ ...prev, advance_id: advance.id }));
            // Add initial empty item
            setLiquidationForm(prev => ({
              ...prev,
              items: [{
                expense_date: new Date().toISOString().split('T')[0],
                category_id: '',
                main_category: '',
                description: '',
                amount: 0,
                receipt_attached: false
              }]
            }));
          }
        } else {
          // Check for liquidation draft advance_id if not provided in URL
          const lDraft = localStorage.getItem('liquidation_draft');
          if (lDraft) {
            try {
              const parsed = JSON.parse(lDraft);
              if (parsed.advance_id) {
                const advance = advancesRes.data?.find((a: CashAdvance) => a.id === parsed.advance_id);
                if (advance) setSelectedAdvance(advance);
              }
            } catch (e) { /* silent */ }
          }
        }

        // Initialize department if user has one
        if (userData.department_id) {
          const isStaff = userData.role !== 'admin' && userData.role !== 'accounting';
          
          setReimbursementForm(prev => {
            if (isStaff || !prev.department_id) {
              return { ...prev, department_id: userData.department_id };
            }
            return prev;
          });
          
          setCashAdvanceForm(prev => {
            if (isStaff || !prev.department_id) {
              return { ...prev, department_id: userData.department_id };
            }
            return prev;
          });
        } else if (departmentsRes.data?.length > 0) {
          // If no department, default to first one for admins
          setReimbursementForm(prev => prev.department_id ? prev : ({ ...prev, department_id: departmentsRes.data[0].id }));
          setCashAdvanceForm(prev => prev.department_id ? prev : ({ ...prev, department_id: departmentsRes.data[0].id }));
        }

        // Now that data is loaded and department is set correctly, notify about drafts if they were restored
        if (localStorage.getItem('reimbursement_draft')) toast.success('Restored draft for reimbursement', { id: 'r-draft' });
        if (localStorage.getItem('cash_advance_draft')) toast.success('Restored draft for cash advance', { id: 'c-draft' });
        if (localStorage.getItem('liquidation_draft')) toast.success('Restored draft for liquidation', { id: 'l-draft' });
      } catch (err) {
        toast.error('Failed to load form data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [navigate, initialAdvanceId]);

  // Re-fetch categories when department or fiscal year changes
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const targetDeptId = activeTab === 'reimbursement' ? reimbursementForm.department_id : cashAdvanceForm.department_id;
    if (!targetDeptId) return;

    const loadCategoriesAndCostCenters = async () => {
      try {
        const currentFiscalYear = user?.fiscal_year || new Date().getFullYear();
        const [categoriesRes, costCentersRes] = await Promise.all([
          api.get(`/api/budget/categories?department_id=${targetDeptId}&fiscal_year=${currentFiscalYear}`),
          api.get(`/api/budget/cost-centers?department_id=${targetDeptId}`)
        ]);

        setCategories(categoriesRes.data || []);
        setCostCenters(costCentersRes.data || []);
      } catch (err) {
        console.error('Failed to load department-specific data', err);
      }
    };

    loadCategoriesAndCostCenters();

    // Poll for new categories every 5 seconds
    const intervalId = setInterval(loadCategoriesAndCostCenters, 5000);
    return () => clearInterval(intervalId);
  }, [user?.id, activeTab, reimbursementForm.department_id, cashAdvanceForm.department_id]);

  // Save active tab
  useEffect(() => {
    localStorage.setItem('active_request_tab', activeTab);
  }, [activeTab]);

  // Removed tab-reset logic to allow auto-draft persistence

  const handleSubmitReimbursement = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const token = localStorage.getItem('token');

    try {
      let attachments: any[] = [];
      
      // Upload all files
      if (reimbursementForm.receipt_files.length > 0) {
        for (const file of reimbursementForm.receipt_files) {
          try {
            const uploaded = await uploadSupportingFile(file);
            attachments.push(uploaded);
          } catch (uploadErr: any) {
            console.error('Upload error:', uploadErr);
          }
        }
      }

      // Calculate total and prepare items
      const totalAmount = reimbursementForm.items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      
      // Prepare items with category info for backend
      const itemsForBackend = reimbursementForm.items.map(item => ({
        item_name: item.item_name,
        category: categories.find(c => c.id === item.category_id)?.category_name || '',
        category_id: item.category_id,
        amount: parseFloat(item.amount) || 0
      }));

      await api.post('/api/requests', {
        request_type: 'reimbursement',
        item_name: reimbursementForm.items.map(i => i.item_name).join(', '),
        department_id: reimbursementForm.department_id,
        category: (() => {
          const uniqueCats = [...new Set(reimbursementForm.items.map(i => categories.find(c => c.id === i.category_id)?.category_name || '').filter(Boolean))];
          return uniqueCats.length > 1 ? uniqueCats.join(' / ') : (uniqueCats[0] || 'Uncategorized');
        })(),
        category_id: reimbursementForm.items[0]?.category_id || '',
        amount: totalAmount,
        purpose: reimbursementForm.business_purpose,
        expense_date: reimbursementForm.expense_date,
        cost_center_id: reimbursementForm.cost_center_id,
        project: reimbursementForm.project,
        priority: 'normal',
        attachments,
        items: itemsForBackend,
        metadata: {
          request_type: 'reimbursement',
          expense_date: reimbursementForm.expense_date,
          cost_center_id: reimbursementForm.cost_center_id || null,
          project: reimbursementForm.project || null
        }
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Expense request submitted!');
      localStorage.removeItem('reimbursement_draft');
      navigate('/tracker');
    } catch (err: any) {
      console.error('Submit error:', err);
      let errorMsg = 'Failed to Submit Expense';
      if (err.response?.data?.error) {
        errorMsg = typeof err.response.data.error === 'string' 
          ? err.response.data.error 
          : JSON.stringify(err.response.data.error);
      } else if (err.message) {
        errorMsg = err.message;
      }
      toast.error(`Error: ${errorMsg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitCashAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const token = localStorage.getItem('token');

    const totalAmount = cashAdvanceForm.breakdown.reduce((sum: number, item: any) => sum + (parseFloat(item.amount as string) || 0), 0);

    try {
      let attachments: any[] = [];
      if (cashAdvanceForm.attachments.length > 0) {
        for (const file of cashAdvanceForm.attachments) {
          try {
            const uploaded = await uploadSupportingFile(file);
            attachments.push(uploaded);
          } catch (uploadErr: any) {
            console.error('Upload error:', uploadErr);
          }
        }
      }

      const selectedItem = officialList.find(i => `${i.code} | ${i.itemName}` === cashAdvanceForm.item_name);
      
      await api.post('/api/requests', {
        request_type: 'cash_advance',
        item_name: cashAdvanceForm.item_name,
        department_id: cashAdvanceForm.department_id,
        category: selectedItem?.category || 'Cash Advance',
        amount: totalAmount,
        purpose: cashAdvanceForm.purpose,
        expected_liquidation_date: cashAdvanceForm.expected_liquidation_date,
        priority: 'normal',
        attachments
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Cash advance request submitted!');
      localStorage.removeItem('cash_advance_draft');
      navigate('/tracker');
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to Submit Expense'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitLiquidation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdvance) {
      toast.error('Please select a cash advance to liquidate');
      return;
    }

    setSubmitting(true);
    const token = localStorage.getItem('token');

    try {
      // Upload files
      let attachments: any[] = [];
      if (liquidationForm.attachments.length > 0) {
        for (const file of liquidationForm.attachments) {
          try {
            const uploaded = await uploadSupportingFile(file);
            attachments.push(uploaded);
          } catch (uploadErr) {
            console.error('Upload error:', uploadErr);
          }
        }
      }

      // Create liquidation request
      const totalLiquidated = liquidationForm.items.reduce((sum: number, item: LiquidationItem) => sum + item.amount, 0);
      
      await api.post('/api/requests', {
        request_type: 'liquidation',
        item_name: `Liquidation - ${selectedAdvance.advance_code}`,
        category: 'Liquidation',
        amount: totalLiquidated,
        purpose: `Liquidation for ${selectedAdvance.advance_code}`,
        original_advance_id: selectedAdvance.id,
        priority: 'normal',
        attachments
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Add liquidation items to cash advance
      await api.post(`/api/cash-advances/${selectedAdvance.id}/liquidate`, {
        items: liquidationForm.items
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      await api.post(`/api/cash-advances/${selectedAdvance.id}/submit-liquidation`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Liquidation submitted successfully!');
      localStorage.removeItem('liquidation_draft');
      navigate('/tracker');
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to submit liquidation'));
    } finally {
      setSubmitting(false);
    }
  };

  const addLiquidationItem = () => {
    setLiquidationForm(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          expense_date: new Date().toISOString().split('T')[0],
          category_id: '',
          main_category: '',
          description: '',
          amount: 0,
          receipt_attached: false
        }
      ]
    }));
  };

  const updateLiquidationItem = (index: number, field: keyof LiquidationItem, value: any) => {
    setLiquidationForm((prev: any) => ({
      ...prev,
      items: prev.items.map((item: LiquidationItem, i: number) => i === index ? { ...item, [field]: value } : item)
    }));
  };

  const removeLiquidationItem = (index: number) => {
    setLiquidationForm((prev: any) => ({
      ...prev,
      items: prev.items.filter((_: any, i: number) => i !== index)
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="bms-spinner"></div>
      </div>
    );
  }

  const getTotalBreakdown = () => {
    return cashAdvanceForm.breakdown.reduce((sum: number, item: any) => sum + (parseFloat(item.amount as string) || 0), 0);
  };

  const getTotalLiquidated = () => {
    return liquidationForm.items.reduce((sum: number, item: LiquidationItem) => sum + item.amount, 0);
  };

  return (
    <div className="text-[var(--role-text)] page-transition">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">New Request</h1>
        <p className="page-subtitle">Submit reimbursement, cash advance, or liquidation</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'reimbursement', label: 'Reimbursement', icon: '📄' },
          { key: 'cash_advance', label: 'Cash Advance', icon: '💵' },
          { key: 'liquidation', label: 'Liquidation', icon: '📊' }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as RequestType)}
            className={`px-6 py-3 rounded-2xl font-medium transition-all flex items-center gap-2 ${
              activeTab === tab.key
                ? 'bg-[var(--role-primary)] text-white shadow-lg'
                : 'bg-[var(--role-surface)] border border-[var(--role-border)] text-[var(--role-text)]/70 hover:bg-[var(--role-accent)]'
            }`}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Reimbursement Form */}
      {activeTab === 'reimbursement' && (
        <form onSubmit={handleSubmitReimbursement} className="panel max-w-3xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
            </svg>
            Submit Expense
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Employee</label>
              <input
                type="text"
                value={user?.name || user?.email}
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Expense Date *</label>
              <input
                type="date"
                required
                value={reimbursementForm.expense_date}
                onChange={(e) => setReimbursementForm(prev => ({ ...prev, expense_date: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              />
            </div>
          </div>

          {/* Multiple Items Section */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Expense Items *</label>
            </div>
            
            {reimbursementForm.items.map((item, index) => (
              <div key={index} className="bg-[var(--role-surface)] rounded-xl border border-[var(--role-border)] p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-[var(--role-text)]/70">Item {index + 1}</span>
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newItems = reimbursementForm.items.filter((_, i) => i !== index);
                        setReimbursementForm(prev => ({ ...prev, items: newItems }));
                      }}
                      className="text-red-500 hover:text-red-600 text-sm"
                    >
                      Remove
                    </button>
                  )}
                </div>
                
                <div className="mb-3">
                  <label className="block text-xs text-[var(--role-text)]/60 mb-1">Expense Item *</label>
                  <select
                    required
                    value={item.item_name}
                    onChange={(e) => {
                      const selectedItemValue = e.target.value;
                      const selectedItem = officialList.find(i => `${i.code} | ${i.itemName}` === selectedItemValue);
                      const newItems = [...reimbursementForm.items];
                      newItems[index].item_name = selectedItemValue;
                      newItems[index].main_category = selectedItem?.category || '';
                      newItems[index].category_id = selectedItem ? (categories.find(c => c.category_name === selectedItem.category)?.id || '') : '';
                      setReimbursementForm(prev => ({ ...prev, items: newItems }));
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                  >
                    <option value="">Select expense item...</option>
                    {getUniqueMainCategories()
                      .filter(cat => getItemsByMainCategory(cat, 'canRE').length > 0)
                      .map(cat => (
                        <optgroup key={cat} label={cat}>
                          {getItemsByMainCategory(cat, 'canRE')
                            .filter(i => {
                              const userDeptName = departments.find(d => d.id === reimbursementForm.department_id)?.name || '';
                              const allowedDepts = Array.isArray(i.dept) ? i.dept : [i.dept];
                              return allowedDepts.includes('All Dept') || allowedDepts.some(d => d.toLowerCase() === userDeptName.toLowerCase());
                            })
                            .map(i => (
                              <option key={i.code} value={`${i.code} | ${i.itemName}`}>
                                {i.code} | {i.itemName}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                  </select>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--role-text)]/60 mb-1">Amount</label>
                    <input
                      type="number"
                      required
                      min="0.01"
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => {
                        const newItems = [...reimbursementForm.items];
                        newItems[index].amount = e.target.value;
                        setReimbursementForm(prev => ({ ...prev, items: newItems }));
                      }}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
            
            <button
              type="button"
              onClick={() => {
                setReimbursementForm(prev => ({
                  ...prev,
                  items: [...prev.items, { main_category: '', item_name: '', category_id: '', amount: '' }]
                }));
              }}
              className="w-full py-2 border-2 border-dashed border-[var(--role-border)] rounded-xl text-[var(--role-text)]/70 hover:bg-[var(--role-accent)]/50 transition-colors text-sm font-medium"
            >
              + Add Item
            </button>
            
            {/* Total Amount */}
            <div className="mt-4 pt-4 border-t border-[var(--role-border)]">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Total Amount:</span>
                <span className="text-xl font-bold text-emerald-600">
                  {formatMoney(reimbursementForm.items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0))}
                </span>
              </div>
            </div>
          </div>

          {/* Budget Status Indicator - Shows if selected items have budget available */}
          {reimbursementForm.items.some(i => i.category_id) && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Budget Status</label>
              {(() => {
                // Get all unique categories from items
                const uniqueCategoryIds = [...new Set(reimbursementForm.items.filter(i => i.category_id).map(i => i.category_id))];
                
                return uniqueCategoryIds.map(catId => {
                  const selectedCat = categories.find(c => c.id === catId);
                  if (!selectedCat) return null;
                  
                  const remaining = Number(selectedCat.remaining_amount || 0);
                  const isOutOfBudget = remaining <= 0;
                  const isLowBudget = remaining > 0 && remaining < (Number(selectedCat.allocated_amount || 0) * 0.2);
                  const isAdmin = user?.role === 'admin' || user?.role === 'accounting' || user?.role === 'super_admin';
                
                  if (isOutOfBudget) {
                    return (
                      <div key={catId} className="px-4 py-3 rounded-xl border border-red-300 bg-red-50 flex items-center gap-2">
                        <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-red-700 font-medium">Out of Budget</span>
                        {isAdmin && <span className="text-red-600 text-sm ml-2">(₱{remaining.toLocaleString()} remaining)</span>}
                      </div>
                    );
                  }
                
                  if (isLowBudget) {
                    return (
                      <div key={catId} className="px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 flex items-center gap-2">
                        <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-amber-700 font-medium">Budget Running Low</span>
                        {isAdmin && <span className="text-amber-600 text-sm ml-2">(₱{remaining.toLocaleString()} remaining)</span>}
                      </div>
                    );
                  }
                
                  return (
                    <div key={catId} className="px-4 py-3 rounded-xl border border-emerald-300 bg-emerald-50 flex items-center gap-2">
                      <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-emerald-700 font-medium">Within Budget</span>
                      {isAdmin && <span className="text-emerald-600 text-sm ml-2">(₱{remaining.toLocaleString()} remaining)</span>}
                    </div>
                  );
                });
              })()}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Department *</label>
              <select
                required
                value={reimbursementForm.department_id}
                onChange={(e) => {
                  const val = e.target.value;
                  setReimbursementForm(prev => ({ ...prev, department_id: val, category_id: '', cost_center_id: '' }));
                }}
                disabled={user?.role !== 'admin' && user?.role !== 'accounting'}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] disabled:bg-gray-100"
              >
                {!reimbursementForm.department_id && <option value="">Select department...</option>}
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Cost Center</label>
            <select
              value={reimbursementForm.cost_center_id}
              onChange={(e) => setReimbursementForm(prev => ({ ...prev, cost_center_id: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select cost center...</option>
              {costCenters.map(cc => (
                <option key={cc.id} value={cc.id}>{cc.cost_center_code} - {cc.cost_center_name}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Project (Optional)</label>
            <input
              type="text"
              value={reimbursementForm.project}
              onChange={(e) => setReimbursementForm(prev => ({ ...prev, project: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              placeholder="Enter project name"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Business Purpose *</label>
            <textarea
              required
              value={reimbursementForm.business_purpose}
              onChange={(e) => setReimbursementForm(prev => ({ ...prev, business_purpose: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] min-h-[100px]"
              placeholder="Describe the business purpose..."
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-3">Supporting Documents (Optional)</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {reimbursementForm.receipt_files.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[var(--role-accent)] border border-[var(--role-border)]">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <svg className="w-5 h-5 text-[var(--role-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm truncate">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newFiles = reimbursementForm.receipt_files.filter((_, i) => i !== idx);
                      setReimbursementForm(prev => ({ ...prev, receipt_files: newFiles }));
                    }}
                    className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            
            <div className="border-2 border-dashed border-[var(--role-border)] rounded-xl p-6 text-center hover:border-[var(--role-primary)]/50 transition-colors">
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => {
                  if (e.target.files) {
                    const files = Array.from(e.target.files);
                    setReimbursementForm(prev => ({ ...prev, receipt_files: [...prev.receipt_files, ...files] }));
                  }
                }}
                className="hidden"
                id="receipt-upload"
              />
              <label htmlFor="receipt-upload" className="cursor-pointer">
                <svg className="w-10 h-10 mx-auto mb-2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-[var(--role-text)]/60">
                  Click to add receipts or documents
                </p>
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="btn-secondary px-8"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary px-8 flex-1"
            >
              {submitting ? 'Submitting...' : 'Submit Expense'}
            </button>
          </div>
        </form>
      )}

      {/* Cash Advance Form */}
      {activeTab === 'cash_advance' && (
        <form onSubmit={handleSubmitCashAdvance} className="panel max-w-3xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Cash Advance
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Employee</label>
              <input
                type="text"
                value={user?.name || 'Loading...'}
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100 text-[var(--role-text)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Department *</label>
              <select
                required
                value={cashAdvanceForm.department_id}
                onChange={(e) => {
                  const val = e.target.value;
                  setCashAdvanceForm(prev => ({ ...prev, department_id: val, cost_center_id: '' }));
                }}
                disabled={user?.role !== 'admin' && user?.role !== 'accounting'}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] disabled:bg-gray-100"
              >
                {!cashAdvanceForm.department_id && <option value="">Select department...</option>}
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Cost Center</label>
            <select
              value={cashAdvanceForm.cost_center_id}
              onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, cost_center_id: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select cost center...</option>
              {costCenters.map(cc => (
                <option key={cc.id} value={cc.id}>{cc.cost_center_code} - {cc.cost_center_name}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Main Category *</label>
            <select
              required
              value={cashAdvanceMainCategory}
              onChange={(e) => {
                const selectedMainCat = e.target.value;
                setCashAdvanceMainCategory(selectedMainCat);
                setCashAdvanceForm(prev => ({ 
                  ...prev, 
                  main_category: selectedMainCat,
                  item_name: '',
                  advance_type: ''
                }));
              }}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select main category...</option>
              {getUniqueMainCategories()
                .filter(cat => getItemsByMainCategory(cat, 'canCA').length > 0)
                .map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
            </select>
          </div>

          {cashAdvanceMainCategory && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Sub-category / Item *</label>
              <select
                required
                value={cashAdvanceForm.item_name}
                onChange={(e) => {
                  const selectedItemValue = e.target.value;
                  const selectedItem = officialList.find(i => `${i.code} | ${i.itemName}` === selectedItemValue);
                  setCashAdvanceForm(prev => ({ 
                    ...prev, 
                    item_name: selectedItemValue,
                    advance_type: selectedItem ? selectedItem.category : prev.advance_type
                  }));
                }}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              >
                <option value="">Select sub-category...</option>
                {getItemsByMainCategory(cashAdvanceMainCategory, 'canCA')
                  .filter(item => {
                    const userDeptName = departments.find(d => d.id === cashAdvanceForm.department_id)?.name || '';
                    const allowedDepts = Array.isArray(item.dept) ? item.dept : [item.dept];
                    const isDeptAllowed = allowedDepts.includes('All Dept') || allowedDepts.some(d => d.toLowerCase() === userDeptName.toLowerCase());
                    return isDeptAllowed;
                  })
                  .map(item => (
                    <option key={item.code} value={`${item.code} | ${item.itemName}`}>
                      {item.code} | {item.itemName}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Expected Use Date</label>
              <input
                type="date"
                value={cashAdvanceForm.expected_use_date}
                onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, expected_use_date: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Expected Liquidation Date *</label>
              <input
                type="date"
                required
                value={cashAdvanceForm.expected_liquidation_date}
                onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, expected_liquidation_date: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              />
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium">Estimated Breakdown</label>
              <button
                type="button"
                onClick={() => {
                  setCashAdvanceForm(prev => ({
                    ...prev,
                    breakdown: [...prev.breakdown, { item: '', amount: '' }]
                  }));
                }}
                className="text-sm text-[var(--role-primary)] hover:underline flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>
            <div className="space-y-3">
              {cashAdvanceForm.breakdown.map((item, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="text-sm text-[var(--role-text)]/60">→</span>
                  <select
                    value={item.item}
                    onChange={(e) => {
                      const newBreakdown = [...cashAdvanceForm.breakdown];
                      newBreakdown[index].item = e.target.value;
                      setCashAdvanceForm(prev => ({ ...prev, breakdown: newBreakdown }));
                    }}
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                  >
                    <option value="">Select approved item...</option>
                    {officialList
                      .filter(off => {
                        const userDeptName = departments.find(d => d.id === cashAdvanceForm.department_id)?.name || '';
                        const allowedDepts = Array.isArray(off.dept) ? off.dept : [off.dept];
                        return (allowedDepts.includes('All Dept') || allowedDepts.some(d => d.toLowerCase() === userDeptName.toLowerCase())) && off.canCA;
                      })
                      .map(off => (
                        <option key={off.code} value={`${off.code} | ${off.itemName}`}>
                          {off.code} | {off.itemName}
                        </option>
                      ))}
                  </select>
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--role-text)]/60">₱</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => {
                        const newBreakdown = [...cashAdvanceForm.breakdown];
                        newBreakdown[index].amount = e.target.value;
                        setCashAdvanceForm(prev => ({ ...prev, breakdown: newBreakdown }));
                      }}
                      className="w-full pl-7 pr-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                      placeholder="0.00"
                    />
                  </div>
                  {cashAdvanceForm.breakdown.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newBreakdown = cashAdvanceForm.breakdown.filter((_, i) => i !== index);
                        setCashAdvanceForm(prev => ({ ...prev, breakdown: newBreakdown }));
                      }}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove item"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--role-border)] flex justify-between items-center">
              <span className="font-medium">Total Amount:</span>
              <span className="text-xl font-bold text-emerald-600">{formatMoney(getTotalBreakdown())}</span>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Purpose *</label>
            <textarea
              required
              value={cashAdvanceForm.purpose}
              onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, purpose: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] min-h-[100px]"
              placeholder="Describe the purpose for this cash advance..."
            />
          </div>

          {/* Supporting Documents Section for Cash Advance */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-3">Supporting Documents (Optional)</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {cashAdvanceForm.attachments.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[var(--role-accent)] border border-[var(--role-border)]">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <svg className="w-5 h-5 text-[var(--role-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm truncate">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newAtts = cashAdvanceForm.attachments.filter((_, i) => i !== idx);
                      setCashAdvanceForm(prev => ({ ...prev, attachments: newAtts }));
                    }}
                    className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            
            <div className="border-2 border-dashed border-[var(--role-border)] rounded-xl p-6 text-center hover:border-[var(--role-primary)]/50 transition-colors">
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => {
                  if (e.target.files) {
                    const files = Array.from(e.target.files);
                    setCashAdvanceForm(prev => ({ ...prev, attachments: [...prev.attachments, ...files] }));
                  }
                }}
                className="hidden"
                id="cash-advance-attachments"
              />
              <label htmlFor="cash-advance-attachments" className="cursor-pointer">
                <svg className="w-10 h-10 mx-auto mb-2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-[var(--role-text)]/60">
                  Click to add images or PDFs
                </p>
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="btn-secondary px-8"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary px-8 flex-1"
            >
              {submitting ? 'Submitting...' : 'Cash Advance'}
            </button>
          </div>
        </form>
      )}

      {/* Liquidation Form */}
      {activeTab === 'liquidation' && (
        <form onSubmit={handleSubmitLiquidation} className="panel max-w-4xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            Liquidate Cash Advance
          </h2>

          {/* Select Cash Advance */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Select Cash Advance *</label>
            <select
              required
              value={liquidationForm.advance_id}
              onChange={(e) => {
                const advance = cashAdvances.find(a => a.id === e.target.value);
                setSelectedAdvance(advance || null);
                setLiquidationForm(prev => ({ ...prev, advance_id: e.target.value }));
              }}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select outstanding cash advance...</option>
              {cashAdvances.map(advance => (
                <option key={advance.id} value={advance.id}>
                  {advance.advance_code} - Balance: {formatMoney(advance.balance)} - {advance.purpose}
                </option>
              ))}
            </select>
          </div>

          {selectedAdvance && (
            <div className="mb-6 p-4 rounded-xl bg-blue-50 border border-blue-200">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-blue-600/70">Original Advance</p>
                  <p className="text-lg font-semibold text-blue-700">{formatMoney(selectedAdvance.amount_issued)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-blue-600/70">Liquidated So Far</p>
                  <p className="text-lg font-semibold text-blue-700">
                    {formatMoney(selectedAdvance.amount_issued - selectedAdvance.balance)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-blue-600/70">Remaining Balance</p>
                  <p className="text-lg font-semibold text-emerald-600">{formatMoney(selectedAdvance.balance)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Line Items */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium">Expense Line Items</label>
              <button
                type="button"
                onClick={addLiquidationItem}
                className="btn-secondary text-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-[var(--role-border)]">
                  <tr className="text-left text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">
                    <th className="pb-3 font-medium">Date</th>
                    <th className="pb-3 font-medium">Main Category</th>
                    <th className="pb-3 font-medium">Sub-category</th>
                    <th className="pb-3 font-medium text-right">Amount</th>
                    <th className="pb-3 font-medium text-center">Receipt</th>
                    <th className="pb-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--role-border)]">
                  {liquidationForm.items.map((item, index) => (
                    <tr key={index}>
                      <td className="py-2">
                        <input
                          type="date"
                          value={item.expense_date}
                          onChange={(e) => updateLiquidationItem(index, 'expense_date', e.target.value)}
                          className="w-full px-2 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                        />
                      </td>
                      {/* Main Category Column */}
                      <td className="py-2">
                        <select
                          value={item.main_category || ''}
                          onChange={(e) => {
                            const selectedMainCat = e.target.value;
                            updateLiquidationItem(index, 'main_category', selectedMainCat);
                            updateLiquidationItem(index, 'description', ''); // Reset sub-category
                            updateLiquidationItem(index, 'category_id', ''); // Reset category_id
                          }}
                          className="w-full px-2 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                        >
                          <option value="">Select...</option>
                          {getUniqueMainCategories()
                            .filter(cat => getItemsByMainCategory(cat, 'canRE').length > 0)
                            .map(cat => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                      </td>
                      {/* Sub-category Column - Only shows items from selected main category */}
                      <td className="py-2">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateLiquidationItem(index, 'description', e.target.value)}
                          placeholder="Enter description..."
                          className="w-full px-2 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                        />
                      </td>
                      <td className="py-2">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--role-text)]/60 text-sm">₱</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.amount || ''}
                            onChange={(e) => updateLiquidationItem(index, 'amount', parseFloat(e.target.value) || 0)}
                            className="w-full pl-6 pr-2 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                          />
                        </div>
                      </td>
                      <td className="py-2 text-center">
                        <input
                          type="checkbox"
                          checked={item.receipt_attached}
                          onChange={(e) => updateLiquidationItem(index, 'receipt_attached', e.target.checked)}
                          className="w-5 h-5 rounded border-[var(--role-border)]"
                        />
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => removeLiquidationItem(index)}
                          className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {liquidationForm.items.length === 0 && (
              <div className="text-center py-6 text-[var(--role-text)]/60 border border-dashed border-[var(--role-border)] rounded-xl">
                <p>No items added yet</p>
                <button
                  type="button"
                  onClick={addLiquidationItem}
                  className="mt-2 text-[var(--role-primary)] hover:underline text-sm"
                >
                  Add your first expense item
                </button>
              </div>
            )}
          </div>

          {/* Summary */}
          {liquidationForm.items.length > 0 && selectedAdvance && (
            <div className="mb-6 p-4 rounded-xl bg-gray-50 border border-gray-200">
              <div className="flex justify-between items-center mb-2">
                <span>Total Liquidated:</span>
                <span className="font-semibold">{formatMoney(getTotalLiquidated())}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                <span className="font-medium">Balance:</span>
                <span className={`font-bold ${getTotalLiquidated() > selectedAdvance.balance ? 'text-red-600' : 'text-emerald-600'}`}>
                  {formatMoney(selectedAdvance.balance - getTotalLiquidated())}
                  {getTotalLiquidated() > selectedAdvance.balance ? ' (Over!)' : getTotalLiquidated() < selectedAdvance.balance ? ' (To return)' : ' (Exact)'}
                </span>
              </div>
            </div>
          )}

          {/* Supporting Documents Section for Liquidation */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-3">Supporting Documents / Receipts (Optional)</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {liquidationForm.attachments.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[var(--role-accent)] border border-[var(--role-border)]">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <svg className="w-5 h-5 text-[var(--role-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm truncate">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newAtts = liquidationForm.attachments.filter((_, i) => i !== idx);
                      setLiquidationForm(prev => ({ ...prev, attachments: newAtts }));
                    }}
                    className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            
            <div className="border-2 border-dashed border-[var(--role-border)] rounded-xl p-6 text-center hover:border-[var(--role-primary)]/50 transition-colors">
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => {
                  if (e.target.files) {
                    const files = Array.from(e.target.files);
                    setLiquidationForm(prev => ({ ...prev, attachments: [...prev.attachments, ...files] }));
                  }
                }}
                className="hidden"
                id="liquidation-attachments"
              />
              <label htmlFor="liquidation-attachments" className="cursor-pointer">
                <svg className="w-10 h-10 mx-auto mb-2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-[var(--role-text)]/60">
                  Click to add multiple receipts or documents
                </p>
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="btn-secondary px-8"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedAdvance || liquidationForm.items.length === 0}
              className="btn-primary px-8 flex-1"
            >
              {submitting ? 'Submitting...' : 'Submit Liquidation'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default NewRequestForm;
