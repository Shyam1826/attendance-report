const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const { sql, poolPromise } = require('../config/db');
const { requireAdmin } = require('../middleware/authGuard');

// View Route: Serve roster dashboard (Admin-only)
router.get('/users', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'users.html'));
});

// API READ: Get all users with their departments
router.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        u.EmployeeNo,
        u.FirstName,
        u.LastName,
        u.Role,
        u.EmpType,
        u.IsActive,
        u.DepartmentID,
        d.DepartmentName
      FROM Users u
      INNER JOIN Departments d ON u.DepartmentID = d.DepartmentID
      ORDER BY u.EmployeeNo ASC
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({ error: 'Failed to fetch users roster.' });
  }
});

// API Get Departments (Helper for populating selects)
router.get('/api/departments', requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT DepartmentID, DepartmentName FROM Departments ORDER BY DepartmentName ASC');
    res.json(result.recordset);
  } catch (error) {
    console.error('Fetch departments error:', error);
    res.status(500).json({ error: 'Failed to fetch departments.' });
  }
});

// API CREATE: Register a new hire manually
router.post('/api/users', requireAdmin, async (req, res) => {
  const { employeeNo, firstName, lastName, departmentId, role, password } = req.body;
  
  if (!employeeNo || !firstName || !lastName || !departmentId || !role || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    const pool = await poolPromise;
    
    // Check if EmployeeNo already exists
    const checkUser = await pool.request()
      .input('EmployeeNo', sql.NVarChar(50), employeeNo.trim())
      .query('SELECT COUNT(*) AS count FROM Users WHERE EmployeeNo = @EmployeeNo');
    
    if (checkUser.recordset[0].count > 0) {
      return res.status(400).json({ error: 'Employee Number already exists.' });
    }

    // Securely compile password via bcryptjs
    const passwordHash = bcrypt.hashSync(password, 10);

    await pool.request()
      .input('EmployeeNo', sql.NVarChar(50), employeeNo.trim().toUpperCase())
      .input('FirstName', sql.NVarChar(100), firstName.trim())
      .input('LastName', sql.NVarChar(100), lastName.trim())
      .input('DepartmentID', sql.Int, parseInt(departmentId, 10))
      .input('Role', sql.NVarChar(20), role)
      .input('PasswordHash', sql.NVarChar(sql.MAX), passwordHash)
      .query(`
        INSERT INTO Users (EmployeeNo, FirstName, LastName, DepartmentID, Role, PasswordHash, IsActive)
        VALUES (@EmployeeNo, @FirstName, @LastName, @DepartmentID, @Role, @PasswordHash, 1)
      `);

    res.json({ success: true, message: 'Employee successfully registered!' });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to register employee.' });
  }
});

// API UPDATE: Modify user details
router.put('/api/users/:employeeNo', requireAdmin, async (req, res) => {
  const { employeeNo } = req.params;
  const { firstName, lastName, departmentId, role, password } = req.body;

  if (!firstName || !lastName || !departmentId || !role) {
    return res.status(400).json({ error: 'First name, last name, department, and role are required.' });
  }

  try {
    const pool = await poolPromise;
    
    let updateQuery = `
      UPDATE Users 
      SET FirstName = @FirstName, 
          LastName = @LastName, 
          DepartmentID = @DepartmentID, 
          Role = @Role
    `;

    const request = pool.request()
      .input('TargetEmployeeNo', sql.NVarChar(50), employeeNo)
      .input('FirstName', sql.NVarChar(100), firstName.trim())
      .input('LastName', sql.NVarChar(100), lastName.trim())
      .input('DepartmentID', sql.Int, parseInt(departmentId, 10))
      .input('Role', sql.NVarChar(20), role);

    if (password && password.trim() !== '') {
      const passwordHash = bcrypt.hashSync(password.trim(), 10);
      request.input('PasswordHash', sql.NVarChar(sql.MAX), passwordHash);
      updateQuery += `, PasswordHash = @PasswordHash`;
    }

    updateQuery += ` WHERE EmployeeNo = @TargetEmployeeNo`;

    await request.query(updateQuery);
    res.json({ success: true, message: 'Employee profile updated successfully!' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update employee profile.' });
  }
});

// API DELETE / DEACTIVATE (Soft-Delete Toggle)
router.delete('/api/users/:employeeNo', requireAdmin, async (req, res) => {
  const { employeeNo } = req.params;
  const { isActive } = req.body; // Sets specific status (1 for active, 0 for inactive/deactivated)

  try {
    const pool = await poolPromise;
    const targetStatus = isActive !== undefined ? (isActive ? 1 : 0) : 0;

    await pool.request()
      .input('EmployeeNo', sql.NVarChar(50), employeeNo)
      .input('IsActive', sql.Bit, targetStatus)
      .query('UPDATE Users SET IsActive = @IsActive WHERE EmployeeNo = @EmployeeNo');

    res.json({ 
      success: true, 
      message: targetStatus === 1 ? 'Employee successfully reactivated!' : 'Employee successfully deactivated!' 
    });
  } catch (error) {
    console.error('Toggle status error:', error);
    res.status(500).json({ error: 'Failed to toggle employee active status.' });
  }
});

module.exports = router;
