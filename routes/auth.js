const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { sql, poolPromise } = require('../config/db');

// Localized date-helper utility for Asia/Kolkata timezone with 24-hour formatting
function getKolkataTimestamp() {
  const date = new Date();
  const rawLocale = date.toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false
  });
  
  try {
    const [datePart, timePart] = rawLocale.split(', ');
    const [m, d, y] = datePart.split('/');
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${dd} ${timePart}`;
  } catch (err) {
    // Graceful fallback to ISO timestamp if formatting fails
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }
}

// Helper to log user session events to data/session-audit.log
function logSessionEvent(action, employeeId, fullName, role, status = null) {
  try {
    const logDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, 'session-audit.log');
    const timestamp = getKolkataTimestamp();
    
    let logLine = `[${timestamp}] ACTION: ${action} | User ID: ${employeeId} | Name: ${fullName} | Role: ${role}`;
    if (status) {
      logLine += ` | Status: ${status}`;
    }
    logLine += '\n';
    
    fs.appendFileSync(logPath, logLine);
  } catch (error) {
    console.error('Session Audit Logging Error:', error);
  }
}

// Serve login html page
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, '..', 'views', 'login.html'));
});

// Post handler for local password validation securely backed by database
router.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('EmployeeNo', sql.NVarChar, username)
      .query('SELECT * FROM Users WHERE EmployeeNo = @EmployeeNo');

    const user = result.recordset[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Check if the user account is active
    if (user.IsActive === false || user.IsActive === 0) {
      return res.status(403).json({ error: 'This user account is deactivated.' });
    }

    // Secure bcrypt check against the password hash in the database
    const isValidPassword = await bcrypt.compare(password, user.PasswordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const fName = (!user.FirstName || user.FirstName.toUpperCase() === 'NULL') ? '' : user.FirstName;
    const lName = (!user.LastName || user.LastName.toUpperCase() === 'NULL') ? '' : user.LastName;
    const fullName = `${fName} ${lName}`.trim() || 'Standard Employee';

    // Create session structured precisely to match the relational profile
    req.session.user = {
      id: user.EmployeeNo,
      username: user.EmployeeNo, // for backward compatibility with audit logging
      name: fullName,
      role: user.Role,
      departmentId: user.DepartmentID
    };

    // Log standard credential login success
    logSessionEvent('LOGIN', user.EmployeeNo, fullName, user.Role, 'SUCCESS');

    res.json({ success: true, user: req.session.user });
  } catch (error) {
    console.error('Database authentication error:', error);
    res.status(500).json({ error: 'An internal server error occurred during login.' });
  }
});

// Post handler for simulated Microsoft MSAL login
router.post('/api/auth/msal', (req, res) => {
  const { role } = req.body;
  const selectedRole = role === 'Admin' ? 'Admin' : 'User';
  
  req.session.user = {
    id: selectedRole === 'Admin' ? 'ADMIN001' : 'USER001',
    username: selectedRole === 'Admin' ? 'msal.admin' : 'msal.user',
    name: selectedRole === 'Admin' ? 'MSAL Administrator' : 'MSAL Staff Member',
    role: selectedRole,
    departmentId: 1
  };

  // Log MSAL SSO login success
  logSessionEvent('LOGIN', req.session.user.id, req.session.user.name, req.session.user.role, 'SUCCESS');

  res.json({ success: true, user: req.session.user });
});

// Logout session clearing
router.get('/logout', (req, res) => {
  if (req.session && req.session.user) {
    const user = req.session.user;
    logSessionEvent('LOGOUT', user.id, user.name, user.role);
  }
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
