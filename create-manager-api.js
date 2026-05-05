// Script to create Manager account via API
const http = require('http');

const managerData = {
  name: 'Test Manager',
  email: 'manager.test@madison88.com',
  password: 'Manager123!',
  role: 'manager'
};

function makeRequest(path, method, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function createManager() {
  try {
    console.log('🔄 Creating Manager account...');
    console.log('📧 Email:', managerData.email);
    console.log('🔑 Password:', managerData.password);
    console.log('🎭 Role:', managerData.role);
    console.log('');

    // First get available departments
    console.log('📋 Fetching available departments...');
    const deptsResult = await makeRequest('/api/departments', 'GET');
    
    let departmentId = null;
    let departmentName = null;
    
    if (deptsResult.status === 200 && deptsResult.data && deptsResult.data.length > 0) {
      // Use first available department (e.g., IT Department)
      const itDept = deptsResult.data.find((d) => d.name.toLowerCase().includes('it')) || deptsResult.data[0];
      departmentId = itDept.id;
      departmentName = itDept.name;
      console.log('✅ Found department:', departmentName);
    } else {
      console.log('⚠️ No departments found, creating without department...');
    }

    // First try signup
    const signupResult = await makeRequest('/api/auth/signup', 'POST', {
      name: managerData.name,
      email: managerData.email,
      password: managerData.password,
      role: managerData.role,
      department_id: departmentId
    });

    if (signupResult.status === 201 || signupResult.status === 200) {
      console.log('✅ Manager account created successfully!');
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('📧 Email:', managerData.email);
      console.log('🔑 Password:', managerData.password);
      console.log('🎭 Role:', managerData.role);
      console.log('🏢 Department:', departmentName || 'None');
      console.log('═══════════════════════════════════════');
      console.log('');
      console.log('📝 Login Instructions:');
      console.log('1. Go to http://localhost:5173/');
      console.log('2. Enter email: manager.test@madison88.com');
      console.log('3. Enter password: Manager123!');
      console.log('4. Click Sign In');
      console.log('');
      console.log('🔄 Expected Manager Behavior:');
      console.log('- Sees "Manager Workspace" label');
      console.log('- Can submit requests (goes to Supervisor → Accounting)');
      console.log('- Can view own requests');
      console.log('- Can edit profile and department');
      console.log('- Cannot approve (only Supervisor/Accounting can approve)');
    } else if (signupResult.data?.error?.includes('already exists') || signupResult.data?.message?.includes('already exists')) {
      console.log('⚠️ Account already exists. Testing login...');
      
      // Try to login
      const loginResult = await makeRequest('/api/auth/login', 'POST', {
        email: managerData.email,
        password: managerData.password
      });

      if (loginResult.status === 200 && loginResult.data.token) {
        console.log('✅ Login successful! Account exists and works.');
        console.log('🎭 Role:', loginResult.data.user?.role);
        console.log('🏢 Department:', loginResult.data.user?.department_name || loginResult.data.user?.department_id || 'None');
      } else {
        console.log('❌ Login failed:', loginResult.data);
      }
    } else {
      console.log('❌ Signup error:', signupResult.data);
      console.log('Status:', signupResult.status);
    }

  } catch (error) {
    console.error('❌ Script error:', error.message);
    console.log('');
    console.log('💡 Make sure the backend server is running on http://localhost:5000');
    console.log('   Run: cd c:\\Users\\jcmad\\Desktop\\BMS && node local-dev-server.js');
  }
}

// Check if backend is running first
const testReq = http.request({ hostname: 'localhost', port: 5000, path: '/api/health', method: 'GET', timeout: 3000 }, (res) => {
  if (res.statusCode === 200 || res.statusCode === 404) {
    createManager();
  } else {
    console.log('⚠️ Backend returned status:', res.statusCode);
    createManager(); // Try anyway
  }
});

testReq.on('error', () => {
  console.log('❌ Backend is not running on http://localhost:5000');
  console.log('');
  console.log('💡 Please start the backend first:');
  console.log('   cd c:\\Users\\jcmad\\Desktop\\BMS');
  console.log('   node local-dev-server.js');
  console.log('');
  console.log('Then run this script again.');
});

testReq.on('timeout', () => {
  console.log('❌ Backend connection timed out');
  testReq.destroy();
});

testReq.end();
