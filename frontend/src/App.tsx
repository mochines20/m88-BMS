import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import RequestForm from './pages/RequestForm';
import ReimbursementForm from './pages/ReimbursementForm';
import RequestTracker from './pages/RequestTracker';
import Approvals from './pages/Approvals';
import Reports from './pages/Reports';
import AccountingDashboard from './pages/AccountingDashboard';
import ManagementDashboard from './pages/ManagementDashboard';
import Admin from './pages/Admin';
import Profile from './pages/Profile';
import EmployeeHome from './pages/EmployeeHome';
import FinanceDashboard from './pages/FinanceDashboard';
import BudgetSetup from './pages/BudgetSetup';
import NewRequestForm from './pages/NewRequestForm';
import CashAdvanceAging from './pages/CashAdvanceAging';
import AuditTrail from './pages/AuditTrail';

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<div className="route-shell"><Login /></div>} />
        <Route path="/reset-password" element={<div className="route-shell"><ResetPassword /></div>} />
        <Route path="/*" element={
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/employee" element={<EmployeeHome />} />
              <Route path="/finance" element={<FinanceDashboard />} />
              <Route path="/budget-setup" element={<BudgetSetup />} />
              <Route path="/budget-monitoring" element={<FinanceDashboard />} />
              <Route path="/requests/new" element={<NewRequestForm />} />
              <Route path="/reimbursement" element={<ReimbursementForm />} />
              <Route path="/tracker" element={<RequestTracker />} />
              <Route path="/request/edit/:id" element={<RequestForm />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/accounting" element={<AccountingDashboard />} />
              <Route path="/management" element={<ManagementDashboard />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/cash-advance-aging" element={<CashAdvanceAging />} />
              <Route path="/audit-trail/:requestId?" element={<AuditTrail />} />
            </Routes>
          </Layout>
        } />
      </Routes>
    </Router>
  )
}

export default App
