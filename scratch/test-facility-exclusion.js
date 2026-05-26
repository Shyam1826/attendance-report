const { streamAndBulkInsertAttendanceLogs, parseAndAggregateAttendance } = require('../utils/attendance-parser');
const { sql, poolPromise } = require('../config/db');

async function run() {
  console.log("Starting diagnostic test for internal facility device exclusion filter...");

  // Mock CSV Data containing:
  // - 3 Normal perimeter swipes (should be imported)
  // - 3 Internal facility swipes (should be skipped)
  const csvContent = 
`S.No,Seq ID,DATE,TIME,PersonFirstName,PersonLastName,PersonNo,DeviceName,AreaName,Department
1,3001,2026-05-23,09:15:00,Exclusion,Test,EMP3001,Q1 MAIN ENTRANCE,Main Entrance,IT
2,3002,2026-05-23,09:20:00,Exclusion,Test,EMP3001,SERVER ROOM-IN,Server Room,IT (exclude)
3,3003,2026-05-23,12:05:00,Exclusion,Test,EMP3001,SERVER ROOM-OUT,Server Room,IT (exclude)
4,3004,2026-05-23,14:15:00,Exclusion,Test,EMP3001,HUB ROOM-IN,Hub Room,IT (exclude)
5,3005,2026-05-23,18:05:00,Exclusion,Test,EMP3001,Q1 MAIN EXIT,Main Exit,IT
6,3006,2026-05-23,18:10:00,Exclusion,Test,EMP3001,EXIT-Q2,Q2 Gate,IT
`;

  const buffer = Buffer.from(csvContent, 'utf8');

  try {
    const pool = await poolPromise;

    // Clean up old test records first
    console.log("Cleaning up old test data for EMP3001...");
    await pool.request().query("DELETE FROM AttendanceLogs WHERE EmployeeNo = 'EMP3001';");

    console.log("Mocking memory-buffered CSV upload...");
    const result = await streamAndBulkInsertAttendanceLogs(buffer, '.csv');

    console.log("\n--- Verification Results ---");
    console.log(`- Imported Rows: ${result.importedRows} (Expected: 3 - normal swipes)`);
    console.log(`- Skipped Duplicates: ${result.skippedDuplicates} (Expected: 0)`);

    console.log("\nQuerying database punches for verification...");
    const recordsResult = await pool.request()
      .input('EmployeeNo', sql.NVarChar(50), 'EMP3001')
      .query("SELECT PunchDateTime, DeviceName FROM AttendanceLogs WHERE EmployeeNo = @EmployeeNo ORDER BY PunchDateTime ASC;");

    console.log("Database entries loaded:");
    recordsResult.recordset.forEach((row, i) => {
      console.log(`  [Record #${i+1}] PunchDateTime: ${row.PunchDateTime.toISOString()}, DeviceName: ${row.DeviceName}`);
    });

    const dbRows = recordsResult.recordset;
    const correctImportCount = dbRows.length === 3;
    const noInternalFacility = dbRows.every(r => 
      !['SERVER ROOM-IN', 'SERVER ROOM-OUT', 'HUB ROOM-IN'].includes(r.DeviceName)
    );

    if (correctImportCount && noInternalFacility) {
      console.log("\n✅ SUCCESS: Device exclusion filter works perfectly! Normal perimeter swipes are imported while internal facility rooms are skipped.");
    } else {
      console.error("\n❌ FAILURE: Mismatched counts or internal rooms loaded in database.");
    }

  } catch (err) {
    console.error("\n❌ Exclusion filter verification failed:", err.message);
  }
}

run();
