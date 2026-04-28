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
import Admin from './pages/Admin';
import Profile from './pages/Profile';

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
              <Route path="/request" element={<RequestForm />} />
              <Route path="/reimbursement" element={<ReimbursementForm />} />
              <Route path="/tracker" element={<RequestTracker />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/profile" element={<Profile />} />
            </Routes>
          </Layout>
        } />
      </Routes>
    </Router>
  )
}

export default App
