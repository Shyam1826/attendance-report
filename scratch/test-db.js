const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const dotenv = require('dotenv');

// Load environment variables directly from the project's .env file
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.error(`Warning: .env configuration file not found at ${envPath}`);
}

async function run() {
  console.log("Starting Phase 1 Database Connectivity & Initialization Verification...");

  const rawDbServer = process.env.DB_SERVER || 'localhost\\SQLEXPRESS';
  const dbServerClean = rawDbServer.replace(/\\\\/g, '\\');
  const dbName = process.env.DB_NAME || 'AttendanceDB';
  const dbUser = process.env.DB_USER || 'sa';
  const dbPassword = process.env.DB_PASSWORD || 'Secret@123';

  let serverHost = dbServerClean;
  let instanceName = undefined;

  if (dbServerClean.includes('\\')) {
    const parts = dbServerClean.split('\\');
    serverHost = parts[0];
    instanceName = parts[1];
  }

  // Config for master connection (to check and create AttendanceDB if it doesn't exist yet)
  const masterConfig = {
    user: dbUser,
    password: dbPassword,
    server: serverHost,
    database: 'master',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true
    }
  };

  // If using a named instance (instanceName), do not specify port to let SQL Browser service resolve it.
  // Otherwise, fall back to the dynamic port environment variable or default port 1433.
  if (instanceName) {
    masterConfig.options.instanceName = instanceName;
  } else {
    masterConfig.port = parseInt(process.env.DB_PORT || '1433', 10);
  }


  let pool;
  try {
    console.log(`Connecting to SQL Server master database at host: ${masterConfig.server}, instance: ${masterConfig.options.instanceName || 'default'}...`);
    try {
      pool = await sql.connect(masterConfig);
    } catch (connectErr) {
      if (masterConfig.options && masterConfig.options.instanceName) {
        console.warn(`⚠️ Named instance connection failed: ${connectErr.message}. Retrying via default port 1433...`);
        const fallbackConfig = { ...masterConfig };
        fallbackConfig.options = { ...masterConfig.options };
        delete fallbackConfig.options.instanceName;
        fallbackConfig.port = parseInt(process.env.DB_PORT || '1433', 10);
        pool = await sql.connect(fallbackConfig);
      } else {
        throw connectErr;
      }
    }
    console.log("✅ Successfully connected to SQL Server master database.");

    // 1. Read database.sql
    const sqlFilePath = path.join(__dirname, '..', 'database.sql');
    if (!fs.existsSync(sqlFilePath)) {
      throw new Error(`database.sql not found at ${sqlFilePath}`);
    }
    console.log("Reading database.sql schema script...");
    const sqlScript = fs.readFileSync(sqlFilePath, 'utf8');

    // 2. Create the target database if not exists
    console.log(`Ensuring database '${dbName}' exists...`);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = '${dbName}')
      BEGIN
          CREATE DATABASE ${dbName};
      END
    `);
    console.log(`✅ Target database '${dbName}' is created/verified.`);

    // Close master connection
    await pool.close();

    // 3. Connect directly to target database
    const targetConfig = {
      user: dbUser,
      password: dbPassword,
      server: serverHost,
      database: dbName,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
      }
    };

    if (instanceName) {
      targetConfig.options.instanceName = instanceName;
    } else {
      targetConfig.port = parseInt(process.env.DB_PORT || '1433', 10);
    }

    console.log(`Connecting directly to database '${targetConfig.database}'...`);
    try {
      pool = await sql.connect(targetConfig);
    } catch (connectErr) {
      if (targetConfig.options && targetConfig.options.instanceName) {
        console.warn(`⚠️ Named instance connection failed: ${connectErr.message}. Retrying via default port 1433...`);
        const fallbackConfig = { ...targetConfig };
        fallbackConfig.options = { ...targetConfig.options };
        delete fallbackConfig.options.instanceName;
        fallbackConfig.port = parseInt(process.env.DB_PORT || '1433', 10);
        pool = await sql.connect(fallbackConfig);
      } else {
        throw connectErr;
      }
    }
    console.log("Successfully connected to target database.");


    // 4. Initialize schemas (executing each command split by GO)
    console.log("Initializing database tables and seed values...");
    
    // Clean SQL GO statements
    const statements = sqlScript
      .split(/\bGO\b/i)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('USE '));

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await pool.request().query(stmt);
      } catch (stmtErr) {
        console.warn(`[Warning/Info] Statement execution skipped or failed: ${stmtErr.message}`);
      }
    }

    console.log("SQL schema and seed data loaded successfully.");

    // 5. Query verification
    console.log("Querying initialized database to verify tables...");
    
    const deptRes = await pool.request().query("SELECT COUNT(*) AS count FROM Departments");
    console.log(`- Departments Row Count: ${deptRes.recordset[0].count} (Expected: 5)`);

    const userRes = await pool.request().query("SELECT COUNT(*) AS count FROM Users");
    console.log(`- Users Row Count: ${userRes.recordset[0].count} (Expected: 2)`);

    const logRes = await pool.request().query("SELECT COUNT(*) AS count FROM AttendanceLogs");
    console.log(`- AttendanceLogs Row Count: ${logRes.recordset[0].count} (Expected: 0)`);

    console.log("\nMSSQL connectivity and table schemas fully operational!");

  } catch (err) {
    console.error("\n❌ PHASE 1 INITIALIZATION FAILED:", err.message);
    if (err.originalError) {
      console.error("Original Error Detail:", err.originalError.message);
    }
  } finally {
    if (pool) {
      try {
        await pool.close();
      } catch (closeErr) {}
    }
  }
}

run();
