import { useEffect, useState } from 'react';
import api from '../api';

interface HealthStatus {
  timestamp: string;
  supabase: {
    status: 'healthy' | 'unhealthy';
    error: string | null;
  };
  backend: {
    status: 'healthy' | 'degraded';
    uptime: number;
  };
  counts: {
    departments: number;
    users: number;
    requests: number;
    expenses: number;
  };
}

const HealthStatus = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const checkHealth = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/system/health', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setHealth(res.data);
      setLastCheckTime(new Date());
    } catch (err) {
      console.error('Health check failed:', err);
      setHealth({
        timestamp: new Date().toISOString(),
        supabase: {
          status: 'unhealthy',
          error: 'Failed to connect to Supabase'
        },
        backend: {
          status: 'degraded',
          uptime: 0
        },
        counts: {
          departments: 0,
          users: 0,
          requests: 0,
          expenses: 0
        }
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    return status === 'healthy' ? 'text-green-400' : status === 'degraded' ? 'text-yellow-400' : 'text-red-400';
  };

  const getStatusBg = (status: string) => {
    return status === 'healthy' ? 'bg-green-500/10 border-green-500/20' : status === 'degraded' ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-red-500/10 border-red-500/20';
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  if (loading && !health) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-24 bg-white/5 rounded-lg"></div>
        <div className="h-24 bg-white/5 rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Backend Status */}
        <div className={`border rounded-lg p-6 ${getStatusBg(health?.backend.status || 'unhealthy')}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Backend Server</h3>
            <div className={`w-3 h-3 rounded-full ${health?.backend.status === 'healthy' ? 'bg-green-500' : health?.backend.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'}`}></div>
          </div>
          <div className="space-y-2">
            <p className={`font-medium ${getStatusColor(health?.backend.status || 'unhealthy')}`}>
              {health?.backend.status === 'healthy' ? '✓ Running' : health?.backend.status === 'degraded' ? '⚠ Degraded' : '✗ Down'}
            </p>
            <p className="text-sm text-white/70">Uptime: {formatUptime(health?.backend.uptime || 0)}</p>
          </div>
        </div>

        {/* Supabase Status */}
        <div className={`border rounded-lg p-6 ${getStatusBg(health?.supabase.status || 'unhealthy')}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Database (Supabase)</h3>
            <div className={`w-3 h-3 rounded-full ${health?.supabase.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`}></div>
          </div>
          <div className="space-y-2">
            <p className={`font-medium ${getStatusColor(health?.supabase.status || 'unhealthy')}`}>
              {health?.supabase.status === 'healthy' ? '✓ Connected' : '✗ Disconnected'}
            </p>
            {health?.supabase.error && (
              <p className="text-sm text-red-300">{health.supabase.error}</p>
            )}
          </div>
        </div>
      </div>

      {/* System Counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <p className="text-sm text-white/60 mb-2">Departments</p>
          <p className="text-2xl font-bold text-white">{health?.counts.departments || 0}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <p className="text-sm text-white/60 mb-2">Users</p>
          <p className="text-2xl font-bold text-white">{health?.counts.users || 0}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <p className="text-sm text-white/60 mb-2">Requests</p>
          <p className="text-2xl font-bold text-white">{health?.counts.requests || 0}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <p className="text-sm text-white/60 mb-2">Expenses</p>
          <p className="text-2xl font-bold text-white">{health?.counts.expenses || 0}</p>
        </div>
      </div>

      <p className="text-xs text-white/40">
        Last checked: {lastCheckTime?.toLocaleTimeString()}
      </p>
    </div>
  );
};

export default HealthStatus;
