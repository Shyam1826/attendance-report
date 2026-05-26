const sql = require('mssql');
require('dotenv').config();

const rawDbServer = process.env.DB_SERVER || 'localhost\\SQLEXPRESS';
const dbServerClean = rawDbServer.replace(/\\\\/g, '\\');

let serverHost = dbServerClean;
let instanceName = undefined;

if (dbServerClean.includes('\\')) {
  const parts = dbServerClean.split('\\');
  serverHost = parts[0];
  instanceName = parts[1];
}

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: serverHost,
  database: process.env.DB_NAME,
  options: {
    encrypt: false, // Set to false for local development to keep it straightforward
    trustServerCertificate: true, // True allows connecting to SQLEXPRESS without local certificate errors
    enableArithAbort: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

// If using a named instance (instanceName), do not specify port to let SQL Browser service resolve it.
// Otherwise, fall back to the dynamic port environment variable or default port 1433.
if (instanceName) {
  dbConfig.options.instanceName = instanceName;
} else {
  dbConfig.port = parseInt(process.env.DB_PORT || '1433', 10);
}



console.log(`Initializing MSSQL pool to server: ${dbConfig.server}, database: ${dbConfig.database}, instance: ${dbConfig.options.instanceName || 'default'}...`);

const connectWithRetry = async () => {
  try {
    const pool = new sql.ConnectionPool(dbConfig);
    await pool.connect();
    console.log('✅ Successfully connected to MSSQL Connection Pool.');
    return pool;
  } catch (err) {
    if (dbConfig.options && dbConfig.options.instanceName) {
      console.warn(`⚠️ Named instance connection failed: ${err.message}. Retrying via default port 1433...`);
      const fallbackConfig = { ...dbConfig };
      fallbackConfig.options = { ...dbConfig.options };
      delete fallbackConfig.options.instanceName;
      fallbackConfig.port = parseInt(process.env.DB_PORT || '1433', 10);
      
      const pool = new sql.ConnectionPool(fallbackConfig);
      await pool.connect();
      console.log('✅ Successfully connected to MSSQL Connection Pool via fallback port 1433.');
      return pool;
    }
    console.error('❌ MSSQL Connection Pool Initialization Failed:', err.message);
    throw err;
  }
};

const poolPromise = connectWithRetry();


module.exports = {
  sql,
  poolPromise
};
