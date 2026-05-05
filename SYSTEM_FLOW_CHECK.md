# BMS System Flow & Connection Verification
**Date:** May 5, 2026  
**Status:** ✅ ALL MODULES CONNECTED

---

## 1. AUTHENTICATION MODULE ✅

### Flow:
```
Login Page → POST /api/auth/login → JWT Token → Store in localStorage
                                         ↓
                              Token includes: id, role, department_id
```

### Connections:
- ✅ Login validates email/password
- ✅ Returns JWT token with user data
- ✅ Token stored in localStorage
- ✅ Auth middleware validates token on all protected routes

---

## 2. USER MANAGEMENT MODULE ✅

### Flow (Super Admin Only):
```
Admin Page → GET /api/auth/users → Display user list
     ↓
Edit User → PATCH /api/auth/users/:id → Update name/role/department
     ↓
Delete User → DELETE /api/auth/users/:id → Remove user
```

### Connections:
- ✅ Super admin can view all users
- ✅ Can change user roles (employee → supervisor → accounting → admin)
- ✅ Can change user department
- ✅ Super admin has NO department (department_id = null)
- ✅ Cannot delete own account

---

## 3. DEPARTMENT BUDGET MANAGEMENT ✅

### Flow:
```
Budget Matrix → GET /api/departments → List all departments
     ↓
Select Department → GET /api/departments/:id/budget-breakdown
     ↓
Update Budget → PATCH /api/departments/:id/budget
```

### Bottom-Up Budget Logic:
```
Department starts: ₱0
     ↓
Add Category A (₱100k) → Total: ₱100k
Add Category B (₱200k) → Total: ₱300k
Update Category A (₱150k) → Total: ₱350k
Delete Category B → Total: ₱150k
```

### Connections:
- ✅ Department budget = sum of category budgets
- ✅ Categories auto-refresh when added/deleted/updated
- ✅ Real-time breakdown showing: budget, used, remaining

---

## 4. CATEGORY BUDGET CRUD ✅

### Flow:
```
Budget Matrix → GET /api/budget/categories?department_id=X
     ↓
Add Category → POST /api/budget/categories
     ↓
Update Budget → PUT /api/budget/categories/:id
     ↓
Delete Category → DELETE /api/budget/categories/:id
```

### Connections:
- ✅ Duplicate prevention (409 Conflict if category_code exists)
- ✅ Budget additive (adds/subtracts from department total)
- ✅ Fiscal year filtering (FY2026)
- ✅ Department isolation (categories tied to departments)

---

## 5. EMPLOYEE REQUEST FLOW ✅

### Flow:
```
Employee Home → Overview of requests & cash advances
     ↓
New Request → GET /api/budget/categories (own department only)
     ↓
Select Category → No budget shown (hidden from employees)
     ↓
Submit Request → POST /api/requests
     ↓
Budget Check → Validates against category remaining budget
```

### Connections:
- ✅ Employee only sees own department's categories
- ✅ Budget amounts hidden from employee view
- ✅ Auto-refresh every 5 seconds for new categories
- ✅ Request auto-assigned to employee's department

---

## 6. APPROVAL WORKFLOW ✅

### Flow:
```
Employee Submits → pending_supervisor
     ↓
Supervisor Approves → pending_accounting
     ↓
Accounting Releases → released (funds deducted from budget)
     ↓
OR
Accounting Holds → on_hold
     ↓
Returned for Revision → returned_for_revision
```

### Approval Endpoints:
- ✅ PATCH /api/requests/:id/approve (supervisor/accounting)
- ✅ PATCH /api/requests/:id/release (accounting only)
- ✅ PATCH /api/requests/:id/reject (supervisor/accounting)
- ✅ PATCH /api/requests/:id/return (supervisor/accounting)
- ✅ PATCH /api/requests/:id/hold (accounting only)

### Connections:
- ✅ Budget deducted when released
- ✅ Notifications sent to relevant users
- ✅ Department filtering enforced

---

## 7. CASH ADVANCE & LIQUIDATION ✅

### Flow:
```
Request Cash Advance → POST /api/requests (type: cash_advance)
     ↓
Approved & Released → Cash advance issued
     ↓
Liquidate → POST /api/requests (type: liquidation)
     ↓
With Items → Multiple expense items with receipts
     ↓
Balance Calculated → Auto-computed (advance - expenses)
```

### Connections:
- ✅ Cash advances tracked separately
- ✅ Outstanding balance visible on employee home
- ✅ Liquidation allows multiple items
- ✅ Due date tracking for aging reports

---

## 8. PETTY CASH MANAGEMENT ✅

### Flow:
```
Check Balance → GET /api/petty-cash/:dept_id
     ↓
Disburse → POST /api/petty-cash/disburse (deduct)
     ↓
Replenish → POST /api/petty-cash/replenish (add)
```

### Connections:
- ✅ Only accounting/admin can modify
- ✅ Department-specific balances
- ✅ Transaction history tracked

---

## 9. REPORTS & ANALYTICS ✅

### Flow:
```
Reports Page → GET /api/reports/filter-options
     ↓
Select Filters → Department, Status, Date Range, Category
     ↓
Generate → GET /api/reports/summary or /export
     ↓
Export → Excel file download
```

### Available Reports:
- ✅ Summary dashboard with charts
- ✅ Filter options (includes budget categories)
- ✅ Export to Excel
- ✅ Cash advance aging report

---

## 10. SECURITY & ROLE-BASED ACCESS ✅

### Role Permissions:

| Feature | Employee | Supervisor | Accounting | Admin | Super Admin |
|---------|----------|------------|------------|-------|-------------|
| View Own Dept Categories | ✅ | ✅ | ✅ | ✅ | ✅ |
| View All Dept Categories | ❌ | ❌ | ✅ | ✅ | ✅ |
| Create Requests | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve as Supervisor | ❌ | ✅ | ❌ | ❌ | ❌ |
| Release Funds | ❌ | ❌ | ✅ | ❌ | ❌ |
| Manage Users | ❌ | ❌ | ❌ | ❌ | ✅ |
| Edit Budgets | ❌ | ❌ | ✅ | ✅ | ✅ |
| Edit Categories | ❌ | ❌ | ✅ | ✅ | ✅ |

---

## MODULE INTERCONNECTIONS DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│                     AUTHENTICATION                          │
│  (JWT Token: id, role, department_id)                       │
└─────────────┬───────────────────────────────────────────────┘
              │
    ┌─────────┴──────────┬──────────────────┐
    ▼                    ▼                  ▼
┌─────────┐       ┌──────────┐      ┌──────────┐
│Employee │       │Supervisor│      │Accounting│
└────┬────┘       └────┬─────┘      └────┬─────┘
     │                 │                  │
     ▼                 ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    DEPARTMENT BUDGET                        │
│  (Categories with fiscal_year, budget_amount, remaining)     │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                   REQUEST WORKFLOW                            │
│  submitted → pending_supervisor → pending_accounting → released│
└─────────────────────────────────────────────────────────────┘
     │
     ├──────────────┬──────────────┐
     ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│Reports   │  │Petty Cash│  │Cash Adv  │
│&Analytics│  │Management│  │& Liquid │
└──────────┘  └──────────┘  └──────────┘
```

---

## CONNECTION STATUS SUMMARY

| Connection | Status |
|------------|--------|
| Frontend → Backend API | ✅ Connected |
| Backend → Supabase DB | ✅ Connected |
| JWT Authentication | ✅ Working |
| Role-Based Access Control | ✅ Working |
| Department Isolation | ✅ Working |
| Budget Category CRUD | ✅ Working |
| Employee Request Flow | ✅ Working |
| Approval Workflow | ✅ Working |
| Cash Advance & Liquidation | ✅ Working |
| Petty Cash Management | ✅ Working |
| Reports & Analytics | ✅ Working |
| Real-time Category Updates | ✅ Working |

---

## TESTED SCENARIOS ✅

1. ✅ Super admin creates department
2. ✅ Accounting adds categories (budget increases)
3. ✅ Employee sees only own department categories
4. ✅ Employee submits request
5. ✅ Supervisor approves request
6. ✅ Accounting releases funds (budget deducted)
7. ✅ Category budget updates in real-time
8. ✅ Reports show correct data
9. ✅ Cash advance issued and liquidated
10. ✅ Petty cash disbursed and replenished

---

## ALL SYSTEMS: CONNECTED & OPERATIONAL ✅
