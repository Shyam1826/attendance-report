const express = require('express');
const router = express.Router();
const path = require('path');
const { sql, poolPromise } = require('../config/db');
const { requireLogin } = require('../middleware/authGuard');

// 🟢 1. View Route for Dashboard
router.get('/dashboard', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'dashboard.html'));
});

// 🟢 2. Independent route to fetch all master directory departments
router.get('/api/departments', requireLogin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query('SELECT DepartmentID, DepartmentName FROM Departments ORDER BY DepartmentName ASC');
    
    res.json(result.recordset);
  } catch (error) {
    console.error('Failed to fetch master department list:', error);
    res.status(500).json({ error: 'Failed to fetch departments.' });
  }
});

// 🟢 NEW ENDPOINT: Live Roster Database Fetch for Employee Management Screen
router.get('/api/users', requireLogin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        u.EmployeeNo,
        u.FirstName,
        u.LastName,
        u.DepartmentID,
        d.DepartmentName,
        u.EmpType,
        u.Role,
        u.IsActive
      FROM Users u
      LEFT JOIN Departments d ON u.DepartmentID = d.DepartmentID
      ORDER BY u.EmployeeNo ASC
    `);
    
    res.json(result.recordset);
  } catch (error) {
    console.error('Production user roster payload compilation failed:', error);
    res.status(500).json({ error: 'Roster database read pipeline failed.' });
  }
});

// 🟢 3. LIVE PRODUCTION ATTENDANCE ENGINE: MIN/MAX First-In/Last-Out Aggregation
router.get('/api/attendance', requireLogin, async (req, res) => {
  try {
    const { startDate, endDate, departmentId, employeeId, status } = req.query;
    const pool = await poolPromise;

    let queryStr = `
      SELECT 
        a.EmployeeNo,
        CONCAT(u.FirstName, ' ', u.LastName) AS Name,
        d.DepartmentName AS Department,
        u.EmpType,
        CAST(a.PunchDateTime AS DATE) AS AttendanceDate,
        MIN(a.PunchDateTime) AS FirstIn,
        MAX(a.PunchDateTime) AS LastOut
      FROM AttendanceLogs a
      INNER JOIN Users u ON a.EmployeeNo = u.EmployeeNo
      INNER JOIN Departments d ON u.DepartmentID = d.DepartmentID
      WHERE 1=1
    `;

    const request = pool.request();

    if (startDate && endDate) {
      queryStr += ` AND CAST(a.PunchDateTime AS DATE) BETWEEN @StartDate AND @EndDate`;
      request.input('StartDate', sql.Date, startDate);
      request.input('EndDate', sql.Date, endDate);
    }
    if (departmentId && departmentId !== 'All' && departmentId !== '') {
      queryStr += ` AND u.DepartmentID = @DepartmentId`;
      request.input('DepartmentId', sql.Int, parseInt(departmentId, 10));
    }
    if (employeeId && employeeId.trim() !== '') {
      queryStr += ` AND (u.EmployeeNo LIKE @EmpNo OR u.FirstName LIKE @EmpNo OR u.LastName LIKE @EmpNo)`;
      request.input('EmpNo', sql.NVarChar, `%${employeeId.trim()}%`);
    }

    queryStr += `
      GROUP BY a.EmployeeNo, u.FirstName, u.LastName, d.DepartmentName, u.EmpType, CAST(a.PunchDateTime AS DATE)
      ORDER BY AttendanceDate DESC, a.EmployeeNo;
    `;

    const result = await request.query(queryStr);
    const rawRows = result.recordset;

    if (!rawRows || rawRows.length === 0) {
      return res.json({ records: [], lineChart: [], doughnutChart: {} });
    }

    const processedRecords = rawRows.map(row => {
      const firstIn = new Date(row.FirstIn);
      const lastOut = new Date(row.LastOut);
      
      const isSinglePunch = firstIn.getTime() === lastOut.getTime();

      let totalHours = '-';
      let calculatedStatus = 'ONTIME';

      if (!isSinglePunch) {
        const diffMs = lastOut - firstIn;
        const decimalHours = diffMs / (1000 * 60 * 60);
        totalHours = decimalHours.toFixed(2);

        // Convert FirstIn and LastOut into net minutes from midnight
        const firstInMins = firstIn.getHours() * 60 + firstIn.getMinutes();
        const lastOutMins = lastOut.getHours() * 60 + lastOut.getMinutes();

        // Morning Grace Window: On-Time if <= 9:10 AM (550 mins). Late if > 550 mins.
        const isLate = firstInMins > 550;
        
        // Evening Standard Departure: On-Time if >= 6:00 PM (1080 mins). Early if < 1080 mins.
        const isEarly = lastOutMins < 1080;

        if (isEarly) {
          if (isLate) {
            calculatedStatus = 'LATE_ENTRY_AND_EARLY_EXIT';
          } else {
            calculatedStatus = 'EARLY_DEPARTURE';
          }
        } else {
          if (isLate) {
            calculatedStatus = 'LATE_ENTRY_AND_LATE_EXIT';
          } else {
            if (decimalHours > 9.0) {
              calculatedStatus = 'OVERTIME';
            } else {
              calculatedStatus = 'ONTIME';
            }
          }
        }
      } else {
        calculatedStatus = 'Incomplete Record';
      }

      const dateObj = new Date(row.AttendanceDate);
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = weekdayNames[dateObj.getDay()];

      return {
        EmployeeID: row.EmployeeNo,
        Name: row.Name || 'Standard Employee',
        Department: row.Department,
        EmpType: row.EmpType || 'Regular',
        Date: dateStr,
        Weekday: dayName,
        FirstIn: firstIn.toLocaleTimeString('en-US', { hour12: false }),
        LastOut: isSinglePunch ? 'Missing Checkout' : lastOut.toLocaleTimeString('en-US', { hour12: false }),
        TotalHours: totalHours,
        Status: calculatedStatus
      };
    });

    const filteredRecords = status && status !== 'All'
      ? processedRecords.filter(r => r.Status === status)
      : processedRecords;

    // --- ANALYTICS CHART AGGREGATIONS ---
    // Strictly exactly 5 core compliance categories - 'Incomplete Record' category completely excluded
    const statusDistribution = { 
      'ONTIME': 0, 
      'OVERTIME': 0, 
      'LATE_ENTRY_AND_LATE_EXIT': 0, 
      'LATE_ENTRY_AND_EARLY_EXIT': 0, 
      'EARLY_DEPARTURE': 0 
    };
    const trendsByDay = {};

    filteredRecords.forEach(item => {
      // Exclude 'Incomplete Record' from charts and daily worked hours trends completely
      if (item.Status !== 'Incomplete Record') {
        if (statusDistribution[item.Status] !== undefined) {
          statusDistribution[item.Status] += 1;
        }

        if (!trendsByDay[item.Date]) {
          trendsByDay[item.Date] = { totalHours: 0, count: 0 };
        }
        const parsedHours = parseFloat(item.TotalHours);
        if (!isNaN(parsedHours)) {
          trendsByDay[item.Date].totalHours += parsedHours;
          trendsByDay[item.Date].count += 1;
        }
      }
    });

    const lineChartData = Object.keys(trendsByDay)
      .sort((a, b) => a.localeCompare(b))
      .map(day => {
        const dData = trendsByDay[day];
        return {
          date: day,
          avgHours: dData.count > 0 ? parseFloat((dData.totalHours / dData.count).toFixed(2)) : 0
        };
      });

    res.json({
      records: filteredRecords,
      statuses: Object.keys(statusDistribution),
      lineChart: lineChartData,
      doughnutChart: statusDistribution
    });

  } catch (error) {
    console.error('Production Query Processing Failed:', error);
    res.status(500).json({ error: 'Failed to compile database metrics.' });
  }
});

module.exports = router;