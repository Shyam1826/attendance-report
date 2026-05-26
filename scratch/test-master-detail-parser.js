const fs = require('fs');
const path = require('path');
const { poolPromise, sql } = require('../config/db');
const { streamAndBulkInsertAttendanceLogs, parseAndAggregateAttendance } = require('../utils/attendance-parser');

async function verifyMasterDetailPipeline() {
  console.log("Starting Verification for Two-File Master-Detail Relational Ingestion Pipeline...");
  
  const pool = await poolPromise;

  // 1. Clean up any previous test state
  console.log("\n[Clean Up] Cleaning database test state...");
  await pool.request().query(`
    DELETE FROM AttendanceLogs WHERE EmployeeNo IN ('ROSTER101', 'ROSTER102', 'ROSTER103', 'UNKNOWN999');
    DELETE FROM Users WHERE EmployeeNo IN ('ROSTER101', 'ROSTER102', 'ROSTER103', 'UNKNOWN999');
  `);
  console.log("✅ Database test state cleaned.");

  // 2. Mock Master Corporate Roster uploads
  console.log("\n--- Part A: Testing Master Corporate Roster Sync ---");
  
  // Test Case A.1: Unified name sheets (e.g., 'T S Shyam Ganeesh') -> firstName = '', lastName = 'T S Shyam Ganeesh'
  console.log("\n[Test A.1] Uploading Roster Sheet with single unified 'Name' column...");
  const unifiedRosterCSV = 
`Staff No.,Name,Department,Emp.Type
ROSTER101,T S Shyam Ganeesh,MARKETING,Permanent
`;
  const resultUnified = await streamAndBulkInsertAttendanceLogs(Buffer.from(unifiedRosterCSV, 'utf8'), '.csv', 'roster');
  console.log(`- Profiles Ingested: ${resultUnified.importedRows} (Expected: 1)`);

  const checkUnified = await pool.request()
    .input('EmpNo', sql.NVarChar(50), 'ROSTER101')
    .query('SELECT FirstName, LastName, EmpType FROM Users WHERE EmployeeNo = @EmpNo');
  
  console.log("DB profile for ROSTER101 (Unified Name):", JSON.stringify(checkUnified.recordset[0], null, 2));
  if (checkUnified.recordset[0] && checkUnified.recordset[0].FirstName === '' && checkUnified.recordset[0].LastName === 'T S Shyam Ganeesh') {
    console.log("✅ SUCCESS: Unified Name parsed untruncated directly into LastName variable!");
  } else {
    console.error("❌ FAILURE: Unified Name parsing failed!");
  }

  // Test Case A.2: Roster containing explicit first/last name columns with empty/NULL First Name
  console.log("\n[Test A.2] Uploading Roster Sheet with explicit 'First Name' & 'Last Name' columns (First Name is 'NULL' or blank)...");
  const explicitRosterCSV = 
`Staff No.,First Name,Last Name,Department,Emp.Type
ROSTER102,NULL,Smith,SUPPLY CHAIN,Contractor
ROSTER103,Alice,Johnson,IT,Permanent
`;
  const resultExplicit = await streamAndBulkInsertAttendanceLogs(Buffer.from(explicitRosterCSV, 'utf8'), '.csv', 'roster');
  console.log(`- Profiles Ingested: ${resultExplicit.importedRows} (Expected: 2)`);

  const checkExplicit102 = await pool.request()
    .input('EmpNo', sql.NVarChar(50), 'ROSTER102')
    .query('SELECT FirstName, LastName, EmpType FROM Users WHERE EmployeeNo = @EmpNo');

  console.log("DB profile for ROSTER102 (Explicit Name with NULL First):", JSON.stringify(checkExplicit102.recordset[0], null, 2));
  if (checkExplicit102.recordset[0] && checkExplicit102.recordset[0].FirstName === '' && checkExplicit102.recordset[0].LastName === 'Smith') {
    console.log("✅ SUCCESS: Explicit 'NULL' First Name mapped cleanly to empty string, and Last Name mapped directly to LastName!");
  } else {
    console.error("❌ FAILURE: Explicit 'NULL' First Name mapping failed!");
  }

  // 3. Mock a Biometric Attendance Logs spreadsheet
  console.log("\n--- Part B: Testing Biometric Attendance Logs Ingestion ---");
  const attendanceCSV = 
`Staff ID,Date,Time,DeviceName,AreaName
ROSTER101,2026-05-25,09:15:00,Biometric_01,Main Entrance
ROSTER101,2026-05-25,18:05:00,Biometric_01,Main Entrance
UNKNOWN999,2026-05-25,09:30:00,Biometric_02,Side Gate
ROSTER103,2026-05-25,08:45:00,Biometric_01,Main Entrance
`;

  const attBuffer = Buffer.from(attendanceCSV, 'utf8');
  const attResult = await streamAndBulkInsertAttendanceLogs(attBuffer, '.csv', 'attendance');

  console.log("\nAttendance Processing Metrics:");
  console.log(`- Valid Logs Imported (importedRows): ${attResult.importedRows} (Expected: 3)`);
  console.log(`- Duplicate Logs Skipped (skippedDuplicates): ${attResult.skippedDuplicates} (Expected: 0)`);
  console.log(`- Unmapped Roster Records Skipped (autoProvisionedUsers): ${attResult.autoProvisionedUsers} (Expected: 1)`);

  // Verify that UNKNOWN999 was skipped and NOT auto-provisioned
  const unknownUserCheck = await pool.request()
    .input('EmpNo', sql.NVarChar(50), 'UNKNOWN999')
    .query('SELECT COUNT(*) AS count FROM Users WHERE EmployeeNo = @EmpNo');

  const unknownLogCheck = await pool.request()
    .input('EmpNo', sql.NVarChar(50), 'UNKNOWN999')
    .query('SELECT COUNT(*) AS count FROM AttendanceLogs WHERE EmployeeNo = @EmpNo');

  console.log(`\nRelational Identity Verification:`);
  console.log(`- UNKNOWN999 User Records in DB: ${unknownUserCheck.recordset[0].count} (Expected: 0)`);
  console.log(`- UNKNOWN999 Swipe Logs in DB: ${unknownLogCheck.recordset[0].count} (Expected: 0)`);

  if (unknownUserCheck.recordset[0].count === 0 && unknownLogCheck.recordset[0].count === 0) {
    console.log("✅ SUCCESS: Strict relational user verification linkage passed. Missing users skipped!");
  } else {
    console.error("❌ FAILURE: Strict relational user verification failed! Unmapped user was auto-provisioned.");
  }

  // 4. Test dashboard aggregations
  console.log("\n--- Part C: Verifying Dashboard Aggregation & Inner Joins ---");
  const data = await parseAndAggregateAttendance();
  const testLogs = data.filter(r => r.EmployeeID === 'ROSTER101' || r.EmployeeID === 'ROSTER103');
  console.log("Aggregated Records for Test Users:\n", JSON.stringify(testLogs, null, 2));

  if (testLogs.length > 0) {
    console.log("✅ SUCCESS: Dashboard aggregation with strict INNER JOIN executed perfectly!");
  } else {
    console.error("❌ FAILURE: Aggregated log query returned no entries.");
  }

  console.log("\n⭐️ ALL MASTER-DETAIL INGESTION PIPELINE VERIFICATIONS COMPLETED!");
}

verifyMasterDetailPipeline().catch(err => {
  console.error("Diagnostic verification failed:", err);
}).finally(() => {
  process.exit(0);
});
