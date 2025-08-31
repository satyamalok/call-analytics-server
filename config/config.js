require('dotenv').config();

module.exports = {
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development'
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'callanalytics',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'password'
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*'
  },
  nocodb: {
    apiUrl: process.env.NOCODB_API_URL || 'https://db.tsblive.in/api/v2/tables',
    apiToken: process.env.NOCODB_API_TOKEN || '',
    tables: {
      callRecords: process.env.NOCODB_CALL_RECORDS_TABLE || '',
      dailyStats: process.env.NOCODB_DAILY_STATS_TABLE || '',
      idleSessions: process.env.NOCODB_IDLE_SESSIONS_TABLE || ''
    },
    views: {
      callRecords: process.env.NOCODB_CALL_RECORDS_VIEW || '',
      dailyStats: process.env.NOCODB_DAILY_STATS_VIEW || '',
      idleSessions: process.env.NOCODB_IDLE_SESSIONS_VIEW || ''
    }
  }
};