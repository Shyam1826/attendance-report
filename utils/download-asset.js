const { Readable } = require('stream');

module.exports = {
  streamCSV: (res, records) => {
    try {
      // Standard CSV headers
      const headers = ['Employee ID', 'First Name', 'Last Name', 'Department', 'Date', 'Weekday', 'First Check In', 'Last Check Out', 'Total Time', 'Status'];
      
      // Escape helper to prevent empty file generation or formatting errors when values are null, undefined, or contain double quotes
      const cleanValue = (val) => {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };

      // Map rows cleanly with standard escaping for Excel
      const rows = (records || []).map(item => {
        if (!item) return [];
        return [
          cleanValue(item.EmployeeID),
          cleanValue(item.FirstName),
          cleanValue(item.LastName),
          cleanValue(item.Department),
          cleanValue(item.Date),
          cleanValue(item.Weekday),
          cleanValue(item.FirstIn),
          cleanValue(item.LastOut),
          cleanValue(item.TotalHours),
          cleanValue(item.Status)
        ];
      }).filter(row => row.length > 0);

      // Glue into CSV payload
      const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
      
      // Set attachment HTTP response headers
      const timestampStr = new Date().toISOString().substring(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Attendance_Report_${timestampStr}.csv"`);
      
      // Stream response
      const stream = Readable.from([csvContent]);
      stream.pipe(res);
    } catch (err) {
      console.error('Error generating CSV stream:', err);
      if (!res.headersSent) {
        res.status(500).send('Error generating export file');
      }
    }
  }
};
