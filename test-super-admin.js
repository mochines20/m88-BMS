const axios = require('axios');

// Test if super admin can access reports
async function testSuperAdminReports() {
  try {
    const response = await axios.get('http://localhost:5000/api/reports/requests', {
      headers: {
        'Authorization': 'Bearer test-token'
      }
    });
    
    console.log('Super admin reports access test:', response.status);
    console.log('Response data:', response.data ? 'SUCCESS' : 'FAILED');
    
    if (response.status === 200) {
      console.log('✅ Super admin can now access reports!');
    } else {
      console.log('❌ Super admin still cannot access reports:', response.status);
    }
  } catch (error) {
    console.log('❌ Error testing super admin reports:', error.message);
  }
}

testSuperAdminReports();
