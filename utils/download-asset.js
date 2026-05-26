const { Readable } = require('stream');

module.exports = {
  streamCSV: (res, records) => {
    // Standard CSV headers
    const headers = ['Employee ID', 'First Name', 'Last Name', 'Department', 'Date', 'Weekday', 'First Check In', 'Last Check Out', 'Total Time'];
    
    // Map rows cleanly with standard escaping for Excel
    const rows = records.map(item => [
      item.EmployeeID,
      `"${item.FirstName}"`,
      `"${item.LastName}"`,
      `"${item.Department}"`,
      item.Date,
      item.Weekday,
      item.FirstIn,
      item.LastOut,
      item.TotalHours
    ]);

    // Glue into CSV payload
    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    // Set attachment HTTP response headers
    const timestampStr = new Date().toISOString().substring(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="Attendance_Report_${timestampStr}.csv"`);
    
    // Stream response
    const stream = Readable.from([csvContent]);
    stream.pipe(res);
  }
};
