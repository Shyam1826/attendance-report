const XLSX = require('xlsx');
const { streamAndBulkInsertAttendanceLogs, parseAndAggregateAttendance } = require('../utils/attendance-parser');
const { sql, poolPromise } = require('../config/db');

async function run() {
  console.log("Starting diagnostic test for Excel numeric serial date/time decoding...");

  // 1. Construct Mock Excel data in memory using SheetJS
  // Date: 45992 -> represents 2025-12-01
  // Time: 0.385417 -> represents 09:15:00
  // Time: 0.753472 -> represents 18:05:00
  const ws_data = [
    ["S.No", "Seq ID", "DATE", "TIME", "PersonFirstName", "PersonLastName", "PersonNo", "DeviceName", "AreaName", "Department"],
    [1, 2001, 45992, 0.385417, "TestExcel", "User", "EMP2001", "Biometric_01", "Main Entrance", "IT"],
    [2, 2002, 45992, 0.753472, "TestExcel", "User", "EMP2001", "Biometric_01", "Main Entrance", "IT"]
  ];

  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  try {
    const pool = await poolPromise;

    // Clean up test data first to ensure clean import
    console.log("Cleaning up previous test data for EMP2001...");
    await pool.request().query(`
      DELETE FROM AttendanceLogs WHERE EmployeeNo = 'EMP2001';
      DELETE FROM Users WHERE EmployeeNo = 'EMP2001';
    `);

    console.log("Mocking memory-buffered Excel upload...");
    const result = await streamAndBulkInsertAttendanceLogs(buffer, '.xlsx');

    console.log("\n--- Uploader Transaction Metrics ---");
    console.log(`- Imported Rows: ${result.importedRows} (Expected: 2)`);
    console.log(`- Skipped Duplicates: ${result.skippedDuplicates} (Expected: 0)`);
    
    console.log("\nQuerying aggregate report to verify dates...");
    const records = await parseAndAggregateAttendance();
    const testRecords = records.filter(r => r.EmployeeID === 'EMP2001');

    console.log("Aggregated Records for Excel Test User:", JSON.stringify(testRecords, null, 2));

    if (testRecords.length > 0) {
      const rec = testRecords[0];
      const correctDate = rec.Date === "01-12-2025";
      const correctFirstIn = rec.FirstIn === "9:15 AM";
      const correctLastOut = rec.LastOut === "6:05 PM";
      const correctWeekday = rec.Weekday === "Monday";

      if (correctDate && correctFirstIn && correctLastOut && correctWeekday) {
        console.log("\n✅ SUCCESS: Excel numeric serial date/time successfully decoded, stored, and aggregated perfectly!");
      } else {
        console.error("\n❌ FAILURE: Mismatched time/date output. Check timezone offsets or conversion formulas.");
      }
    } else {
      console.error("\n❌ FAILURE: No records found in the database for EMP2001.");
    }

  } catch (err) {
    console.error("\n❌ Excel numeric diagnostic failed:", err.message);
  }
}

run();
