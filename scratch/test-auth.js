const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const sql = require('mssql');
const dotenv = require('dotenv');

// Load environment variables directly from the project's .env file
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.error(`Warning: .env configuration file not found at ${envPath}`);
}

// Reuse connection config logic from config/db.js to align connection settings
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

const dbConfig = {
  user: dbUser,
  password: dbPassword,
  server: serverHost,
  database: dbName,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

if (instanceName) {
  dbConfig.options.instanceName = instanceName;
} else {
  dbConfig.port = parseInt(process.env.DB_PORT || '1433', 10);
}

// Programmatic login function replicating routes/auth.js logic exactly
async function runLogin(pool, username, password) {
  const result = await pool.request()
    .input('EmployeeNo', sql.NVarChar, username)
    .query('SELECT * FROM Users WHERE EmployeeNo = @EmployeeNo');

  const user = result.recordset[0];
  if (!user) {
    throw new Error('UNAUTHORIZED: Invalid username or password.');
  }

  // Deactivation check
  if (user.IsActive === false || user.IsActive === 0) {
    throw new Error('DEACTIVATED: This user account is deactivated.');
  }

  // Password verification
  const isValidPassword = await bcrypt.compare(password, user.PasswordHash);
  if (!isValidPassword) {
    throw new Error('UNAUTHORIZED: Invalid username or password.');
  }

  // Serialized session payload structure
  return {
    id: user.EmployeeNo,
    username: user.EmployeeNo,
    name: `${user.FirstName || ''} ${user.LastName || ''}`.trim() || 'Standard Employee',
    role: user.Role,
    departmentId: user.DepartmentID
  };
}

async function run() {
  console.log("Starting Phase 2: Relational Authentication Integrity Verification...");
  
  let pool;
  try {
    // Connect using our robust self-healing logic
    console.log(`Connecting to SQL Server at host: ${dbConfig.server}, instance: ${dbConfig.options.instanceName || 'default'}...`);
    try {
      pool = await sql.connect(dbConfig);
    } catch (connectErr) {
      if (dbConfig.options && dbConfig.options.instanceName) {
        console.warn(`⚠️ Named instance connection failed: ${connectErr.message}. Retrying via default port 1433...`);
        const fallbackConfig = { ...dbConfig };
        fallbackConfig.options = { ...dbConfig.options };
        delete fallbackConfig.options.instanceName;
        fallbackConfig.port = parseInt(process.env.DB_PORT || '1433', 10);
        pool = await sql.connect(fallbackConfig);
      } else {
        throw connectErr;
      }
    }
    console.log("✅ Successfully connected to database pool.");

    // Ensure database contains a deactivated user to test deactivation paths
    console.log("\n[Setting Up Test State] Ensuring a deactivated user exists...");
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM Users WHERE EmployeeNo = 'TESTINACTIVE')
      BEGIN
        INSERT INTO Users (EmployeeNo, FirstName, LastName, DepartmentID, Role, PasswordHash, IsActive)
        VALUES ('TESTINACTIVE', 'Inactive', 'User', 1, 'User', '$2a$10$bJ/N1w1N6f3q1m/QW8c64ee3P5p4R68e.F16J/n1F1q2Z3C4S5s6O', 0);
      END
      ELSE
      BEGIN
        UPDATE Users SET IsActive = 0 WHERE EmployeeNo = 'TESTINACTIVE';
      END
    `);

    // TEST CASE 1: Valid Admin Credentials
    console.log("\n--- TEST CASE 1: Valid Admin Login ('ADMIN001' / 'Admin@123') ---");
    try {
      const sessionUser = await runLogin(pool, 'ADMIN001', 'Admin@123');
      console.log("✅ TEST PASSED: Authentication succeeded.");
      console.log("Constructed Session Payload:", JSON.stringify(sessionUser, null, 2));
    } catch (err) {
      console.error("❌ TEST FAILED:", err.message);
    }

    // TEST CASE 2: Valid User Credentials
    console.log("\n--- TEST CASE 2: Valid User Login ('USER001' / 'User@123') ---");
    try {
      const sessionUser = await runLogin(pool, 'USER001', 'User@123');
      console.log("✅ TEST PASSED: Authentication succeeded.");
      console.log("Constructed Session Payload:", JSON.stringify(sessionUser, null, 2));
    } catch (err) {
      console.error("❌ TEST FAILED:", err.message);
    }

    // TEST CASE 3: Invalid Password
    console.log("\n--- TEST CASE 3: Invalid Password ('ADMIN001' / 'WrongPassword123') ---");
    try {
      await runLogin(pool, 'ADMIN001', 'WrongPassword123');
      console.error("❌ TEST FAILED: Authentication should have been rejected.");
    } catch (err) {
      if (err.message.includes("UNAUTHORIZED")) {
        console.log(`✅ TEST PASSED: Connection pool rejected login correctly. Reason: "${err.message}"`);
      } else {
        console.error("❌ TEST FAILED with unexpected error:", err.message);
      }
    }

    // TEST CASE 4: Non-existent Employee No
    console.log("\n--- TEST CASE 4: Non-existent Username ('UNKNOWN_ID' / 'Secret@123') ---");
    try {
      await runLogin(pool, 'UNKNOWN_ID', 'Secret@123');
      console.error("❌ TEST FAILED: Authentication should have been rejected.");
    } catch (err) {
      if (err.message.includes("UNAUTHORIZED")) {
        console.log(`✅ TEST PASSED: Connection pool rejected login correctly. Reason: "${err.message}"`);
      } else {
        console.error("❌ TEST FAILED with unexpected error:", err.message);
      }
    }

    // TEST CASE 5: Deactivated User
    console.log("\n--- TEST CASE 5: Deactivated Profile ('TESTINACTIVE' / 'User@123') ---");
    try {
      await runLogin(pool, 'TESTINACTIVE', 'User@123');
      console.error("❌ TEST FAILED: Deactivated profile was incorrectly authenticated.");
    } catch (err) {
      if (err.message.includes("DEACTIVATED")) {
        console.log(`✅ TEST PASSED: Connection pool rejected deactivated account correctly. Reason: "${err.message}"`);
      } else {
        console.error("❌ TEST FAILED with unexpected error:", err.message);
      }
    }

    console.log("\n⭐️ ALL AUTHENTICATION INTEGRITY TESTS RUN COMPLETED!");

  } catch (err) {
    console.error("\n❌ PHASE 2 VERIFICATION FAILED:", err.message);
  } finally {
    if (pool) {
      await pool.close();
      console.log("\nDatabase connection closed.");
    }
  }
}

run();
