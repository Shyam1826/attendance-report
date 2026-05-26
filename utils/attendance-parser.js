const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const { Readable } = require('stream');
const { sql, poolPromise } = require('../config/db');

const INTERNAL_FACILITIES = [
    'SERVER ROOM-IN', 'SERVER ROOM-OUT', 
    'STORE ROOM-IN', 'HUB ROOM-IN', 'HUB ROOM-OUT',
    'Q2-ELECTRICAL ROOM-IN', 'Q3 ELE ROOM-IN'
];

// Helper: Format Date object to HH:MM AM/PM string
function formatAMPM(date) {
  let hours = date.getHours();
  let minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  minutes = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutes} ${ampm}`;
}

// Helper: Convert time string to minutes
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':');
  const hrs = parseInt(parts[0], 10) || 0;
  const mins = parseInt(parts[1], 10) || 0;
  return hrs * 60 + mins;
}

// Helper: Convert minutes back to AM/PM string
function minutesToTimeString(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const ampm = hrs >= 12 ? 'PM' : 'AM';
  const displayHrs = hrs % 12 === 0 ? 12 : hrs % 12;
  const displayMins = mins < 10 ? '0' + mins : mins;
  return `${displayHrs}:${displayMins} ${ampm}`;
}

// Robust date-time merging parser supporting strings, Excel numeric serials, and Native Date objects
function parseDateTime(dateVal, timeVal) {
  if (!dateVal) return null;

  // Handle Excel numeric serial dates & times
  if (typeof dateVal === 'number' || (typeof dateVal === 'string' && !isNaN(Number(dateVal)) && dateVal.trim() !== '' && !dateVal.includes('-') && !dateVal.includes('/'))) {
    const rawDate = Number(dateVal);
    let dateObj = new Date((rawDate - 25569) * 86400 * 1000);
    
    // Excel decimal fraction represents time
    let rawTime = timeVal;
    if (typeof rawTime === 'string' && !isNaN(Number(rawTime)) && rawTime.trim() !== '') {
      rawTime = Number(rawTime);
    }

    if (typeof rawTime === 'number') {
      let totalSeconds = Math.round(rawTime * 24 * 60 * 60);
      let hours = Math.floor(totalSeconds / 3600);
      let minutes = Math.floor((totalSeconds % 3600) / 60);
      dateObj.setUTCHours(hours, minutes, 0, 0);
    } else if (rawTime) {
      const timeStr = String(rawTime).trim();
      const timeParts = timeStr.split(':');
      const hrs = parseInt(timeParts[0], 10) || 0;
      const mins = parseInt(timeParts[1], 10) || 0;
      const secs = parseInt(timeParts[2], 10) || 0;
      dateObj.setUTCHours(hrs, mins, secs, 0);
    }

    // Shift the UTC time back to local time to prevent local timezone shifts in database and front-end
    const localTime = new Date(dateObj.getTime() + dateObj.getTimezoneOffset() * 60000);
    return localTime;
  }
  
  if (dateVal instanceof Date) {
    if (timeVal) {
      const timeStr = String(timeVal).trim();
      const timeParts = timeStr.split(':');
      const hrs = parseInt(timeParts[0], 10) || 0;
      const mins = parseInt(timeParts[1], 10) || 0;
      const secs = parseInt(timeParts[2], 10) || 0;
      const mergedDate = new Date(dateVal);
      mergedDate.setHours(hrs, mins, secs, 0);
      return mergedDate;
    }
    return dateVal;
  }

  const dateStr = String(dateVal).trim();
  const timeStr = timeVal ? String(timeVal).trim() : '00:00:00';

  let year, month, day;
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      day = parseInt(parts[2], 10);
    } else {
      // DD-MM-YYYY
      day = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      year = parseInt(parts[2], 10);
    }
  } else if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts[2] && parts[2].length === 4) {
      // MM/DD/YYYY or DD/MM/YYYY
      month = parseInt(parts[0], 10) - 1;
      day = parseInt(parts[1], 10);
      year = parseInt(parts[2], 10);
    } else {
      month = parseInt(parts[0], 10) - 1;
      day = parseInt(parts[1], 10);
      year = parseInt(parts[2], 10);
    }
  } else {
    const parsed = new Date(`${dateStr} ${timeStr}`);
    if (!isNaN(parsed.getTime())) return parsed;
    return null;
  }

  const timeParts = timeStr.split(':');
  const hrs = parseInt(timeParts[0], 10) || 0;
  const mins = parseInt(timeParts[1], 10) || 0;
  const secs = parseInt(timeParts[2], 10) || 0;

  const finalDate = new Date(year, month, day, hrs, mins, secs, 0);
  return isNaN(finalDate.getTime()) ? null : finalDate;
}

// Case-insensitive cell extraction helper
function getVal(row, key) {
  const cleanKey = key.toLowerCase().replace(/\s/g, '');
  for (const k of Object.keys(row)) {
    if (k.toLowerCase().replace(/\s/g, '') === cleanKey) {
      return row[k];
    }
  }
  return undefined;
}

// Unified streaming and native bulk copy processor supporting Master Roster and Biometric Logs
async function streamAndBulkInsertAttendanceLogs(buffer, extension, uploadType = 'attendance') {
  const pool = await poolPromise;
  
  // 0. Self-healing check: Ensure EmpType column exists in the database
  try {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT * FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'EmpType'
      )
      BEGIN
        ALTER TABLE dbo.Users ADD EmpType NVARCHAR(50);
      END
    `);
  } catch (err) {
    console.warn("Failed to check or alter Users table for EmpType:", err.message);
  }

  // 1. Relational Cache Loading
  console.log("Caching Departments and Users in memory...");
  const deptResult = await pool.request().query('SELECT DepartmentID, DepartmentName FROM Departments');
  const deptCache = new Map();
  deptResult.recordset.forEach(d => {
    deptCache.set(d.DepartmentName.toLowerCase().trim(), d.DepartmentID);
  });

  const userResult = await pool.request().query('SELECT EmployeeNo, DepartmentID FROM Users');
  const userCache = new Set();
  userResult.recordset.forEach(u => {
    userCache.add(u.EmployeeNo.toUpperCase().trim());
  });

  // 2. Load rows dynamically based on file format
  let rows = [];
  if (extension === '.csv') {
    const parser = Readable.from(buffer).pipe(csv());
    for await (const row of parser) {
      rows.push(row);
    }
  } else if (extension === '.xlsx' || extension === '.xls') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' });
  }

  // 3. Process rows sequentially
  console.log(`Processing ${rows.length} rows for type: ${uploadType}...`);
  
  const duplicateSet = new Set();
  let importedRowsCount = 0;
  let skippedDuplicatesCount = 0;
  let autoProvisionedUsersCount = 0;
  let autoProvisionedDeptsCount = 0;

  if (uploadType === 'roster') {
    for (const row of rows) {
      const StaffNo = getVal(row, 'Staff No.') || getVal(row, 'Staff No') || getVal(row, 'StaffNo') || getVal(row, 'EmployeeNo') || getVal(row, 'PersonNo') || getVal(row, 'Person No') || getVal(row, 'Staff ID');
      if (!StaffNo) continue;
      
      const cleanStaffNo = String(StaffNo).trim().toUpperCase();
      if (cleanStaffNo === '') continue;

      const DepartmentName = String(getVal(row, 'Department') || getVal(row, 'DepartmentName') || getVal(row, 'Department Name') || 'IT').trim();
      const EmpType = String(getVal(row, 'Emp.Type') || getVal(row, 'EmpType') || getVal(row, 'Employment Type') || getVal(row, 'EmploymentType') || '').trim();

      // Resolve FirstName and LastName based on available columns
      const explicitFirstName = getVal(row, 'First Name') || getVal(row, 'FirstName');
      const explicitLastName = getVal(row, 'Last Name') || getVal(row, 'LastName');
      const unifiedName = getVal(row, 'Name') || getVal(row, 'FullName') || getVal(row, 'Full Name');

      let firstName = '';
      let lastName = '';

      if (explicitFirstName !== undefined || explicitLastName !== undefined) {
        const cleanFirst = String(explicitFirstName || '').trim();
        if (cleanFirst === '' || cleanFirst.toUpperCase() === 'NULL') {
          firstName = '';
        } else {
          firstName = cleanFirst;
        }

        const cleanLast = String(explicitLastName || '').trim();
        if (cleanLast.toUpperCase() === 'NULL') {
          lastName = '';
        } else {
          lastName = cleanLast;
        }
      } else if (unifiedName !== undefined) {
        firstName = '';
        const cleanName = String(unifiedName || '').trim();
        if (cleanName.toUpperCase() === 'NULL') {
          lastName = '';
        } else {
          lastName = cleanName;
        }
      } else {
        firstName = 'New';
        lastName = 'Employee';
      }

      // Relational Department Auto-Provisioning
      let deptId;
      const deptKey = DepartmentName.toLowerCase();
      if (!deptCache.has(deptKey)) {
        const insertDept = await pool.request()
          .input('DepartmentName', sql.NVarChar(100), DepartmentName)
          .query('INSERT INTO Departments (DepartmentName) OUTPUT INSERTED.DepartmentID VALUES (@DepartmentName)');
        deptId = insertDept.recordset[0].DepartmentID;
        deptCache.set(deptKey, deptId);
        autoProvisionedDeptsCount++;
        console.log(`Auto-provisioned Department: ${DepartmentName} (ID: ${deptId})`);
      } else {
        deptId = deptCache.get(deptKey);
      }

      // SQL UPSERT logic in Users
      const userExistsQuery = await pool.request()
        .input('EmployeeNo', sql.NVarChar(50), cleanStaffNo)
        .query('SELECT COUNT(*) AS count FROM Users WHERE EmployeeNo = @EmployeeNo');
      
      const exists = userExistsQuery.recordset[0].count > 0;
      if (exists) {
        // Update user
        await pool.request()
          .input('EmployeeNo', sql.NVarChar(50), cleanStaffNo)
          .input('FirstName', sql.NVarChar(100), firstName)
          .input('LastName', sql.NVarChar(100), lastName)
          .input('DepartmentID', sql.Int, deptId)
          .input('EmpType', sql.NVarChar(50), EmpType)
          .query(`
            UPDATE Users 
            SET FirstName = @FirstName,
                LastName = @LastName,
                DepartmentID = @DepartmentID,
                EmpType = @EmpType
            WHERE EmployeeNo = @EmployeeNo
          `);
        skippedDuplicatesCount++; // unchanged/updated profile profile
      } else {
        // Insert user fresh
        await pool.request()
          .input('EmployeeNo', sql.NVarChar(50), cleanStaffNo)
          .input('FirstName', sql.NVarChar(100), firstName)
          .input('LastName', sql.NVarChar(100), lastName)
          .input('DepartmentID', sql.Int, deptId)
          .input('EmpType', sql.NVarChar(50), EmpType)
          .query(`
            INSERT INTO Users (EmployeeNo, FirstName, LastName, DepartmentID, Role, EmpType, PasswordHash, IsActive)
            VALUES (@EmployeeNo, @FirstName, @LastName, @DepartmentID, 'User', @EmpType, NULL, 1)
          `);
        userCache.add(cleanStaffNo);
        autoProvisionedUsersCount++; // registered fresh profile count
      }
      importedRowsCount++; // synchronized profile profile count
    }
  } else {
    // Ingestion of Biometric Logs
    const bulkTable = new sql.Table('AttendanceLogs');
    bulkTable.columns.add('EmployeeNo', sql.NVarChar(50), { nullable: true });
    bulkTable.columns.add('PunchDateTime', sql.DateTime, { nullable: false });
    bulkTable.columns.add('DeviceName', sql.NVarChar(100), { nullable: true });
    bulkTable.columns.add('AreaName', sql.NVarChar(100), { nullable: true });

    for (const row of rows) {
      const StaffNo = getVal(row, 'PersonNo') || getVal(row, 'EmployeeNo') || getVal(row, 'Person No') || getVal(row, 'Staff ID') || getVal(row, 'Staff No.') || getVal(row, 'Staff No') || getVal(row, 'StaffNo');
      if (!StaffNo) continue;
      
      const cleanStaffNo = String(StaffNo).trim().toUpperCase();
      if (cleanStaffNo === '') continue;

      const DeviceName = String(getVal(row, 'DeviceName') || getVal(row, 'Device') || '').trim();
      if (INTERNAL_FACILITIES.includes(DeviceName)) {
        continue;
      }
      const AreaName = String(getVal(row, 'AreaName') || getVal(row, 'Area') || '').trim();

      // Parse Date and Time
      const dateVal = getVal(row, 'DATE') || getVal(row, 'Date');
      const timeVal = getVal(row, 'TIME') || getVal(row, 'Time');
      const punchDateTime = parseDateTime(dateVal, timeVal);
      if (!punchDateTime) continue;

      // In-memory set duplicate checking per user + timestamp
      const dupKey = `${cleanStaffNo}_${punchDateTime.toISOString()}`;
      if (duplicateSet.has(dupKey)) {
        skippedDuplicatesCount++;
        continue;
      }
      duplicateSet.add(dupKey);

      // Relational User Integrity Check (No default provisioning falling back to IT)
      if (!userCache.has(cleanStaffNo)) {
        autoProvisionedUsersCount++; // Increment unknown records skipped count
        continue;
      }

      // Add to bulk insert schema (LogID is omitted)
      bulkTable.rows.add(cleanStaffNo, punchDateTime, DeviceName || null, AreaName || null);
      importedRowsCount++;
    }

    // Native high-speed Bulk copy operation
    if (bulkTable.rows.length > 0) {
      console.log(`Executing native bulk copy for ${bulkTable.rows.length} rows directly into SQL Server...`);
      const request = new sql.Request(pool);
      await request.bulk(bulkTable);
      console.log("✅ Native Bulk Copy completed successfully.");
    } else {
      console.log("No new unique records found to bulk copy.");
    }
  }


  return {
    importedRows: importedRowsCount,
    skippedDuplicates: skippedDuplicatesCount,
    autoProvisionedUsers: autoProvisionedUsersCount,
    autoProvisionedDepartments: autoProvisionedDeptsCount
  };
}

// Database-backed main dashboard aggregation
async function parseAndAggregateAttendance() {
  const pool = await poolPromise;
  const result = await pool.request().query(`
    SELECT 
      a.EmployeeNo AS EmployeeID,
      u.FirstName,
      u.LastName,
      u.EmpType,
      d.DepartmentName AS Department,
      a.PunchDateTime
    FROM AttendanceLogs a
    INNER JOIN Users u ON a.EmployeeNo = u.EmployeeNo
    INNER JOIN Departments d ON u.DepartmentID = d.DepartmentID
    ORDER BY a.PunchDateTime ASC
  `);

  const records = result.recordset;
  const grouped = {};

  records.forEach(row => {
    const empId = row.EmployeeID.trim();
    const punchDate = row.PunchDateTime;
    
    // Format Date part as YYYY-MM-DD
    const yyyy = punchDate.getFullYear();
    const mm = String(punchDate.getMonth() + 1).padStart(2, '0');
    const dd = String(punchDate.getDate()).padStart(2, '0');
    const datePart = `${yyyy}-${mm}-${dd}`;
    
    const groupKey = `${empId}_${datePart}`;
    
    if (!grouped[groupKey]) {
      const fName = (!row.FirstName || String(row.FirstName).toUpperCase() === 'NULL') ? '' : row.FirstName;
      const lName = (!row.LastName || String(row.LastName).toUpperCase() === 'NULL') ? '' : row.LastName;
      const fullName = `${fName} ${lName}`.trim() || 'Standard Employee';

      grouped[groupKey] = {
        EmployeeID: empId,
        FirstName: fName,
        LastName: lName,
        Name: fullName,
        Department: row.Department.trim(),
        EmpType: row.EmpType ? row.EmpType.trim() : 'N/A',
        Date: datePart,
        punches: []
      };
    }
    
    grouped[groupKey].punches.push(punchDate);
  });

  const aggregated = Object.values(grouped).map(group => {
    const firstIn = group.punches[0];
    
    let firstInDate = null;
    let lastOutDate = null;
    let totalHours = 0;
    let statusBadge = 'Compliant';

    const isSinglePunch = group.punches.length === 1 || group.punches[group.punches.length - 1].getTime() === firstIn.getTime();

    if (isSinglePunch) {
      const punchTime = firstIn;
      const punchHour = punchTime.getHours();
      
      if (punchHour < 13) {
        // Before 1:00 PM -> Treat as FirstIn
        firstInDate = punchTime;
        lastOutDate = null;
        totalHours = 'Not Checked Out';
        statusBadge = 'Early Departure'; // Missing check out
      } else {
        // At or after 1:00 PM -> Treat as LastOut
        firstInDate = null;
        lastOutDate = punchTime;
        totalHours = 'Not Checked In';
        statusBadge = 'Late Arrival'; // Missing check in
      }
    } else {
      firstInDate = firstIn;
      lastOutDate = group.punches[group.punches.length - 1];

      let durationHours = parseFloat(((lastOutDate.getTime() - firstInDate.getTime()) / (1000 * 60 * 60)).toFixed(2));
      if (durationHours < 0) {
        durationHours = 0;
      }
      totalHours = durationHours;

      const firstInMins = firstInDate.getHours() * 60 + firstInDate.getMinutes();
      const lastOutMins = lastOutDate.getHours() * 60 + lastOutDate.getMinutes();

      const arrivedLate = firstInMins > 540;
      const leftEarly = lastOutMins < 1080;

      if (totalHours > 9.0) {
        statusBadge = 'Overtime';
      } else if (arrivedLate && leftEarly) {
        statusBadge = 'Late & Early';
      } else if (arrivedLate) {
        statusBadge = 'Late Arrival';
      } else if (leftEarly) {
        statusBadge = 'Early Departure';
      }
    }

    const yyyy = firstIn.getFullYear();
    const mm = String(firstIn.getMonth() + 1).padStart(2, '0');
    const dd = String(firstIn.getDate()).padStart(2, '0');
    const formattedDate = `${dd}-${mm}-${yyyy}`; // DD-MM-YYYY format for front-end

    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const weekday = weekdays[firstIn.getDay()];

    return {
      EmployeeID: group.EmployeeID,
      FirstName: group.FirstName,
      LastName: group.LastName,
      Name: group.Name,
      Department: group.Department,
      EmpType: group.EmpType,
      Date: formattedDate,
      rawDate: group.Date, // YYYY-MM-DD format for filters
      Weekday: weekday,
      FirstIn: firstInDate ? formatAMPM(firstInDate) : null,
      LastOut: lastOutDate ? formatAMPM(lastOutDate) : null,
      TotalHours: totalHours,
      Status: statusBadge,
      rawFirstInMins: firstInDate ? (firstInDate.getHours() * 60 + firstInDate.getMinutes()) : null,
      rawLastOutMins: lastOutDate ? (lastOutDate.getHours() * 60 + lastOutDate.getMinutes()) : null,
      Punches: group.punches.map(p => formatAMPM(p))
    };
  });

  return aggregated;
}

// Clean filtering wrapper matching original behavior
function filterAttendanceData(data, filters) {
  let filtered = [...data];
  const { fromDate, toDate, department, status, search } = filters;

  if (fromDate) {
    filtered = filtered.filter(item => item.rawDate >= fromDate);
  }
  if (toDate) {
    filtered = filtered.filter(item => item.rawDate <= toDate);
  }
  if (department && department !== 'All') {
    filtered = filtered.filter(item => item.Department.toLowerCase() === department.toLowerCase());
  }
  if (status && status !== 'All') {
    filtered = filtered.filter(item => item.Status.toLowerCase() === status.toLowerCase());
  }
  if (search && search.trim() !== '') {
    const searchLower = search.toLowerCase().trim();
    filtered = filtered.filter(item => 
      item.Name.toLowerCase().includes(searchLower) || 
      item.EmployeeID.toLowerCase().includes(searchLower)
    );
  }
  return filtered;
}

module.exports = {
  streamAndBulkInsertAttendanceLogs,
  parseAndAggregateAttendance,
  filterAttendanceData
};
