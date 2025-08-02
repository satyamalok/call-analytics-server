require('dotenv').config();

module.exports = {
  server: {
    port: process.env.PORT || 3000,
    env: 'test' // Force test mode
  },
  database: {
    host: 'localhost',
    port: 5432,
    database: 'test',
    user: 'test',
    password: 'test'
  },
  redis: {
    host: 'localhost',
    port: 6379
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*'
  }
};