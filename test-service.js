const nocodbService = require('./src/services/nocodbService');

async function testService() {
  try {
    console.log('Testing nocodbService directly...');
    
    const result = await nocodbService.searchByPhoneNumber('8700', 5);
    
    console.log('Result:', JSON.stringify(result, null, 2));
    
    if (result.list && result.list.length > 0) {
      console.log(`✅ Found ${result.list.length} records`);
    } else {
      console.log('❌ No records found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  process.exit(0);
}

testService();