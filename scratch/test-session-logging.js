const fs = require('fs');
const path = require('path');
const { poolPromise, sql } = require('../config/db');

async function testLogging() {
  console.log("Starting Session Audit Logging Verification...");

  const logDir = path.join(__dirname, '..', 'data');
  const logPath = path.join(logDir, 'session-audit.log');

  // Clean old session logs if they exist
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
  }

  // Import router
  const authRouter = require('../routes/auth');

  // Find the POST handler for /api/auth/login and simulated msal
  // We can mock the request and response objects and execute them directly!
  
  // Find the exact routes registered on the router
  const loginRoute = authRouter.stack.find(layer => layer.route && layer.route.path === '/api/auth/login');
  const msalRoute = authRouter.stack.find(layer => layer.route && layer.route.path === '/api/auth/msal');
  const logoutRoute = authRouter.stack.find(layer => layer.route && layer.route.path === '/logout');

  if (!loginRoute || !msalRoute || !logoutRoute) {
    console.error("❌ Failed to find required routes in authRouter.");
    return;
  }

  const mockRes = {
    json: function (data) {
      console.log("  Response json sent:", JSON.stringify(data));
      return this;
    },
    status: function (code) {
      console.log("  Response status:", code);
      return this;
    },
    redirect: function (url) {
      console.log("  Redirected to:", url);
      return this;
    }
  };

  // 1. Test MSAL Login logging
  console.log("\n--- Executing Simulated MSAL SSO Login Request Mock ---");
  const mockReqMsal = {
    body: { role: 'Admin' },
    session: {}
  };
  
  // Execute router stack handler function for msal
  msalRoute.route.stack[0].handle(mockReqMsal, mockRes);

  // 2. Test Logout logging
  console.log("\n--- Executing Logout Request Mock ---");
  const mockReqLogout = {
    session: {
      user: {
        id: 'ADMIN001',
        name: 'MSAL Administrator',
        role: 'Admin'
      },
      destroy: function(cb) {
        console.log("  Session destroy called.");
        cb();
      }
    }
  };
  
  logoutRoute.route.stack[0].handle(mockReqLogout, mockRes);

  // 3. Verify files
  console.log("\n--- Verifying session-audit.log Content ---");
  if (!fs.existsSync(logPath)) {
    console.error("❌ FAILURE: log file not created!");
    return;
  }

  const logContent = fs.readFileSync(logPath, 'utf8');
  console.log("Log Content:\n" + logContent);

  if (logContent.includes("ACTION: LOGIN") && logContent.includes("ACTION: LOGOUT")) {
    console.log("✅ SUCCESS: Both LOGIN and LOGOUT session audit log records saved perfectly!");
  } else {
    console.error("❌ FAILURE: Missing login or logout records in file.");
  }
}

testLogging().catch(err => {
  console.error("Test failed with error:", err);
});
