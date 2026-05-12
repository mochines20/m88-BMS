import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { normalizeDisplayName , getErrorMessage } from '../utils/format';

interface DepartmentOption {
  id: string;
  name: string;
  fiscal_year?: number;
}

const Profile = () => {
  const [user, setUser] = useState<any>(null);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDepartments, setIsLoadingDepartments] = useState(true);

  const token = localStorage.getItem('token');
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const [meResponse, departmentsResponse] = await Promise.all([
          api.get('/api/auth/me', { headers: authHeaders }),
          api.get<DepartmentOption[]>('/api/departments', { headers: authHeaders })
        ]);

        setUser(meResponse.data);
        setName(normalizeDisplayName(meResponse.data.name || ''));
        setDepartmentId(meResponse.data.department_id || '');
        setDepartments(departmentsResponse.data || []);
        setIsLoadingDepartments(false);
      } catch (err: any) {
        toast.error(getErrorMessage(err, 'Failed to load profile'));
        setIsLoadingDepartments(false);
      } finally {
        setIsLoading(false);
      }
    };

    void loadProfile();
  }, [authHeaders]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Name is required');
      return;
    }

    // VP and President don't have departments, so skip department validation for them
    if (!departmentId && user.role !== 'vp' && user.role !== 'president') {
      toast.error('Please select a department');
      return;
    }

    setIsSaving(true);
    try {
      const payload: any = { name: trimmedName };
      // Only include department_id for roles that have departments
      if (user.role !== 'vp' && user.role !== 'president' && user.role !== 'super_admin') {
        payload.department_id = departmentId || null;
      }
      
      const response = await api.patch(
        '/api/auth/profile',
        payload,
        { headers: authHeaders }
      );

      localStorage.setItem('token', response.data.token);
      setUser(response.data.user);
      setName(normalizeDisplayName(response.data.user.name || trimmedName));
      setDepartmentId(response.data.user.department_id || departmentId);
      toast.success('Profile updated!');
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to update profile'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="text-[var(--role-text)]">Loading profile...</div>;
  }

  if (!user) {
    return <div className="text-[var(--role-text)]">Profile not available.</div>;
  }

  // Profile is available for employees, managers, supervisors, vp, and president
  // (super_admin uses Admin page for profile management)
  if (user.role !== 'employee' && user.role !== 'manager' && user.role !== 'supervisor' && user.role !== 'vp' && user.role !== 'president') {
    return (
      <div className="panel text-[var(--role-text)]">
        <h1 className="page-title text-3xl">Profile</h1>
        <p className="mt-3 text-[var(--role-text)]/80">Profile self-edit is currently available for employees, managers, supervisors, VP, and President only.</p>
      </div>
    );
  }

  return (
    <div className="text-[var(--role-text)]">
      <div className="page-header">
        <h1 className="page-title">My Profile</h1>
        <p className="page-subtitle">
          {user.role === 'vp' || user.role === 'president' 
            ? 'Update your display name for approval authority records.'
            : 'Update your display name and department assignment so your request flow stays aligned.'}
        </p>
      </div>

      <div className="panel max-w-3xl">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="panel-muted">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/60">Role</p>
            <p className="mt-3 text-xl font-semibold text-[var(--role-text)] capitalize">{user.role}</p>
            <p className="mt-2 text-sm text-[var(--role-text)]/75">{user.email}</p>
          </div>
          <div className="panel-muted">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/60">
              {user.role === 'vp' || user.role === 'president' ? 'Approval Authority' : 'Department Update'}
            </p>
            <p className="mt-3 text-sm text-[var(--role-text)]/80">
              {user.role === 'vp' 
                ? 'You can approve requests up to ₱500,000 (and equivalent in other currencies).'
                : user.role === 'president'
                ? 'You can approve requests above ₱500,000 (and equivalent in other currencies).'
                : 'Any change here will affect which department requests you see and submit under.'}
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {/* Only show department notice for roles with departments */}
          {user.role !== 'vp' && user.role !== 'president' && user.role !== 'super_admin' && (
            <div className="rounded-[24px] border border-[#8FB3E2]/10 bg-[#192338]/28 p-4">
              <p className="text-sm font-semibold text-[var(--role-text)]">Department Change Notice</p>
              <p className="mt-2 text-sm text-[var(--role-text)]/90">
                Changing department will also move your existing requests to the new department.
              </p>
            </div>
          )}

          <div>
            <label className="field-label">Full Name</label>
            <input
              className="field-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter your full name"
            />
          </div>

          {/* Only show department field for roles that have departments */}
          {user.role !== 'vp' && user.role !== 'president' && user.role !== 'super_admin' && (
            <div>
              <label className="field-label">Department</label>
              <select 
                className="field-input" 
                value={departmentId} 
                onChange={(event) => setDepartmentId(event.target.value)}
                disabled={isLoadingDepartments}
              >
                <option value="">{isLoadingDepartments ? 'Loading departments...' : 'Select your department'}</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
              {user?.department?.name && (
                <p className="mt-2 text-xs text-[var(--role-text)]/60">
                  Current department: <span className="font-medium">{user.department.name}</span>. 
                  You can only view and create requests for your assigned department.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
