const axios = require('axios');

async function testNocoDB() {
  try {
    const baseUrl = 'https://db.tsblive.in/api/v2/tables';
    const token = 'FuBOYV-1tJ4QmwSwHMyCx0mF6JJNGcnViRa3oGcy';
    const tableId = 'mp8za08hwm8rxst';
    
    console.log('Testing NocoDB API directly...');
    
    // Test 1: Basic query
    console.log('\n1. Testing basic query...');
    const response1 = await axios({
      method: 'GET',
      url: `${baseUrl}/${tableId}/records?limit=2`,
      headers: { 'xc-token': token }
    });
    console.log(`Basic query result: ${response1.data.list.length} records`);
    
    // Test 2: LIKE query with params object
    console.log('\n2. Testing LIKE query with params object...');
    const params = {
      where: '(Mobile,like,%8700%)',
      limit: 5
    };
    
    console.log('Params object:', params);
    
    const response2 = await axios({
      method: 'GET',
      url: `${baseUrl}/${tableId}/records`,
      headers: { 'xc-token': token },
      params: params
    });
    console.log(`LIKE query result: ${response2.data.list.length} records`);
    
    // Test 3: Manual URL construction
    console.log('\n3. Testing manual URL construction...');
    const manualUrl = `${baseUrl}/${tableId}/records?where=${encodeURIComponent('(Mobile,like,%8700%)')}&limit=5`;
    console.log('Manual URL:', manualUrl);
    
    const response3 = await axios({
      method: 'GET',
      url: manualUrl,
      headers: { 'xc-token': token }
    });
    console.log(`Manual URL result: ${response3.data.list.length} records`);
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testNocoDB();