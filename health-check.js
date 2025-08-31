#!/usr/bin/env node

const http = require('http');

console.log('🏥 Starting health check...');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/',
  method: 'GET',
  timeout: 10000
};

const req = http.request(options, (res) => {
  console.log(`🏥 Health check response: ${res.statusCode}`);
  
  if (res.statusCode === 200) {
    console.log('✅ Health check passed');
    process.exit(0);
  } else {
    console.log('❌ Health check failed - bad status code');
    process.exit(1);
  }
});

req.on('error', (err) => {
  console.log('❌ Health check failed - connection error:', err.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.log('❌ Health check failed - timeout');
  req.destroy();
  process.exit(1);
});

req.setTimeout(10000);
req.end();