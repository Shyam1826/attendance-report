const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { requireLogin, requireAdmin } = require('../middleware/authGuard');
const { 
  parseAndAggregateAttendance, 
  filterAttendanceData, 
  streamAndBulkInsertAttendanceLogs 
} = require('../utils/attendance-parser');

// Configure Multer to reside purely inside RAM buffers and never write to physical disk
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv' && ext !== '.xlsx' && ext !== '.xls') {
      return cb(new Error('Only CSV and Excel files (.csv, .xlsx, .xls) are allowed.'));
    }
    cb(null, true);
  }
});

// View Routes
router.get('/dashboard', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'dashboard.html'));
});

router.get('/upload', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'upload.html'));
});

// GET dynamic attendance statistics (Used by front-end charts & tables)
router.get('/api/attendance', requireLogin, async (req, res) => {
  try {
    const data = await parseAndAggregateAttendance();
    const filtered = filterAttendanceData(data, req.query);

    const departmentsList = [...new Set(data.map(item => item.Department))].sort();
    const statusesList = [...new Set(data.map(item => item.Status))].sort();

    // Compliance daily trends (Duration-Based multi-series)
    const trendsByDay = {};
    filtered.forEach(item => {
      const day = item.Date; // formatted as DD-MM-YYYY
      const rawDay = item.rawDate; // formatted as YYYY-MM-DD
      if (!trendsByDay[day]) {
        trendsByDay[day] = { rawDate: rawDay, totalHours: 0, count: 0, compliantCount: 0, lateCount: 0 };
      }
      
      const parsedHours = parseFloat(item.TotalHours);
      if (!isNaN(parsedHours)) {
        trendsByDay[day].totalHours += parsedHours;
        trendsByDay[day].count += 1;
      }
      
      if (item.Status === 'Compliant' || item.Status === 'Overtime') {
        trendsByDay[day].compliantCount += 1;
      }
      if (item.Status === 'Late Arrival' || item.Status === 'Late & Early') {
        trendsByDay[day].lateCount += 1;
      }
    });

    const lineChartData = Object.keys(trendsByDay)
      .sort((a, b) => {
        // Sort chronologically using rawDate (YYYY-MM-DD)
        return trendsByDay[a].rawDate.localeCompare(trendsByDay[b].rawDate);
      })
      .map(day => {
        const dData = trendsByDay[day];
        // Daily average hours formatted to 2 decimals
        const avgHours = dData.count > 0 ? parseFloat((dData.totalHours / dData.count).toFixed(2)) : 0;
        return {
          date: day,
          avgHours: avgHours,
          compliantCount: dData.compliantCount,
          lateCount: dData.lateCount
        };
      });

    // Doughnut badge statuses breakdown
    const statusDistribution = {
      'Compliant': 0,
      'Late Arrival': 0,
      'Early Departure': 0,
      'Late & Early': 0,
      'Overtime': 0
    };
    filtered.forEach(item => {
      if (statusDistribution[item.Status] !== undefined) {
        statusDistribution[item.Status] += 1;
      }
    });

    res.json({
      records: filtered,
      departments: departmentsList,
      statuses: statusesList,
      lineChart: lineChartData,
      doughnutChart: statusDistribution
    });
  } catch (error) {
    console.error('Error fetching attendance logs:', error);
    res.status(500).json({ error: 'Failed to compile attendance statistics.' });
  }
});

// Admin Route: Memory-Buffered log uploader with streaming & native bulk copy
router.post('/api/upload', requireAdmin, upload.single('attendanceFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or invalid file type.' });
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  const uploadType = req.body.uploadType || 'attendance';
  
  try {
    console.log(`Processing file upload: ${req.file.originalname} (${req.file.buffer.length} bytes, type: ${uploadType})...`);
    
    // Process stream and native bulk insert
    const result = await streamAndBulkInsertAttendanceLogs(req.file.buffer, ext, uploadType);
    
    res.json({
      success: true,
      message: uploadType === 'roster' 
        ? `Master Corporate Roster successfully synchronized!` 
        : `Biometric database successfully updated!`,
      importedRows: result.importedRows,
      skippedDuplicates: result.skippedDuplicates,
      autoProvisionedUsers: result.autoProvisionedUsers,
      autoProvisionedDepartments: result.autoProvisionedDepartments
    });
  } catch (err) {
    console.error('File import processing failed:', err);
    res.status(500).json({ 
      error: `Failed to process log upload: ${err.message}` 
    });
  }
});

module.exports = router;
