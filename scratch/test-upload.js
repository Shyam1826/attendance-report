const fs = require('fs');
const path = require('path');
const { streamAndBulkInsertAttendanceLogs, parseAndAggregateAttendance } = require('../utils/attendance-parser');
const { sql, poolPromise } = require('../config/db');

async function run() {
  console.log("Starting Component 3: Upload & Streaming Parser integrity tests...");
  
  // 1. Construct Mock CSV Data
  // Includes headers: S.No, Seq ID, EventTypeId, DATE, TIME, DeviceName, PersonLastName, PersonFirstName, PersonNo, CredentialNo, AreaName
  // We also include Department column to test dynamic auto-provisioning!
  const csvContent = 
`S.No,Seq ID,EventTypeId,DATE,TIME,DeviceName,PersonLastName,PersonFirstName,PersonNo,CredentialNo,AreaName,Department
1,1001,1,2026-05-23,09:15:00,Biometric_01,Doe,Jane,EMP1001,CRED1001,Main Entrance,Research & Development
2,1002,1,2026-05-23,09:15:00,Biometric_01,Doe,Jane,EMP1001,CRED1001,Main Entrance,Research & Development (duplicate check)
3,1003,1,2026-05-23,18:05:00,Biometric_01,Doe,Jane,EMP1001,CRED1001,Main Entrance,Research & Development
4,1004,1,2026-05-23,08:45:00,Biometric_02,Smith,John,EMP1002,CRED1002,Side Entrance,Operations Management
5,1005,1,2026-05-23,17:55:00,Biometric_02,Smith,John,EMP1002,CRED1002,Side Entrance,Operations Management
6,1006,1,2026-05-23,09:00:00,Biometric_01,Swipe,Missing,EMP1003,CRED1003,Main Entrance,IT
`;

  const buffer = Buffer.from(csvContent, 'utf8');

  try {
    const pool = await poolPromise;

    // Clean up test users & departments first to ensure clean provisioning
    console.log("Cleaning old test users & departments...");
    await pool.request().query(`
      DELETE FROM AttendanceLogs WHERE EmployeeNo IN ('EMP1001', 'EMP1002', 'EMP1003');
      DELETE FROM Users WHERE EmployeeNo IN ('EMP1001', 'EMP1002', 'EMP1003');
      DELETE FROM Departments WHERE DepartmentName IN ('Research & Development', 'Operations Management');
    `);

    console.log("Mocking memory-buffered CSV upload...");
    const result = await streamAndBulkInsertAttendanceLogs(buffer, '.csv');

    console.log("\n--- Verification Results ---");
    console.log(`- Imported Rows: ${result.importedRows} (Expected: 5)`);
    console.log(`- Skipped Duplicates: ${result.skippedDuplicates} (Expected: 1)`);
    console.log(`- Auto-Provisioned Users: ${result.autoProvisionedUsers} (Expected: 3)`);
    console.log(`- Auto-Provisioned Departments: ${result.autoProvisionedDepartments} (Expected: 2)`);

    if (result.importedRows === 5 && result.skippedDuplicates === 1 && result.autoProvisionedUsers === 3 && result.autoProvisionedDepartments === 2) {
      console.log("\n✅ SUCCESS: Streaming upload and native bulk insert integrity verified perfectly!");
    } else {
      console.error("\n❌ FAILURE: Mismatched counts.");
    }

    console.log("\nTesting database-backed dashboard aggregate query...");
    const data = await parseAndAggregateAttendance();
    const testRecords = data.filter(r => r.EmployeeID === 'EMP1001' || r.EmployeeID === 'EMP1002' || r.EmployeeID === 'EMP1003');
    console.log("Aggregated Records for Test Users:", JSON.stringify(testRecords, null, 2));

  } catch (err) {
    console.error("\n❌ Diagnostic test failed:", err.message);
  }
}

run();
