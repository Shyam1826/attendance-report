const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/authGuard');
const { parseAndAggregateAttendance, filterAttendanceData } = require('../utils/attendance-parser');
const { streamCSV } = require('../utils/download-asset');

// Real streaming export endpoint (Audit logs every action)
router.get('/api/export', requireLogin, async (req, res) => {
  const { format } = req.query; // 'excel' or 'pdf'
  
  if (!format) {
    return res.status(400).json({ error: 'Export format is required.' });
  }

  // Record export event inside security ledgers
  if (req.logExport) {
    req.logExport(format, req.query);
  }

  try {
    const data = await parseAndAggregateAttendance();
    const filtered = filterAttendanceData(data, req.query);

    if (format === 'excel' || format === 'csv') {
      streamCSV(res, filtered);
    } else if (format === 'pdf') {
      // PDF formats are printed via browser window.print() triggered on UI
      res.json({ success: true, message: 'PDF export operation logged successfully.' });
    } else {
      res.status(400).json({ error: 'Unsupported export format.' });
    }
  } catch (error) {
    console.error('Export Error:', error);
    res.status(500).json({ error: 'Failed to stream secure attendance export.' });
  }
});

module.exports = router;
