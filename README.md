cat << 'EOF' > README.md
# Enterprise Biometric Attendance & Relational Analytics Engine
### **Core Project Identity:** Project Antigravity 🚀

An administrative, high-performance web platform engineered to securely ingest, process, and analyze complex workplace attendance structures. Built for organizational compliance tracking, the system relationally aggregates raw biometric hardware access logs against centralized HR master employee registries over an optimized local database fabric.

---

## 🎯 **System Engineering Features**

### 🛠️ **Core Infrastructure & Pipe Ingestion**
* **Two-File Master-Detail Pipeline:** Decouples operational logistics into two distinct files. It consumes a *Master Corporate Roster* to dynamically establish corporate profiles and a *Biometric Attendance Log* to mass-ingest hardware scanner raw punch logs.
* **High-Speed Bulk Copy Protocol (`request.bulk`):** Bypasses standard, slow row-by-row transaction queries. It maps raw file data arrays directly into native SQL Server table variables to ingest tens of thousands of event records in fractions of a second.
* **In-Memory Streaming Architecture:** Implements a zero-disk streaming blueprint using memory-buffered `Multer` layers. Spreadsheet buffers are parsed in temporary system RAM and completely cleared the exact millisecond the database transaction resolves.

### 🧠 **Advanced Algorithmic Validation**
* **Absolute First-In/Last-Out Analytics Engine:** Eliminates guessing variables by tracking real-world multi-punch tracking cycles. The engine programmatically scans a day's event array, pulling the absolute earliest timestamp as the formal check-in and the absolute latest timestamp as the formal checkout. If an employee logs only a single punch, the counterpart is preserved as `NULL` and flagged contextually (`Not Checked Out` / `Not Checked In`) to highlight anomalies for manual HR adjustments without dropping database integrity.
* **Adaptive Indian Name-Preservation Engine:** Completely suppresses standard Western whitespace-splitting algorithms when dealing with unified string cells (e.g., *"T S Shyam Ganeesh"*). It preserves the untruncated string inside the database `LastName` while cleanly mapping `FirstName` to an empty state (`NULL`), entirely eliminating layout fragmentation.
* **Dynamic Auto-Provisioning Checkpoints:** Scans incoming files for unmapped business departments. If a new department string is detected, the engine dynamically provisions a fresh lookup ID inside the master record matrix without crashing the active file pipeline.

### 📊 **Real-Time Visualization & UI Metrics**
* **10-Column Multi-Field Analytics Grid:** Houses interactive data records containing: *Employee ID, First Name, Last Name, Department, Emp. Type, Date, Weekday, First Check-In, Last Check-Out, and Total Time*.
* **Dynamic Contextual Success Modals:** Toggles UI reporting cards based on the active file upload selector:
  * **Roster Imports:** Counts Profiles Synchronized, Unchanged Profiles, and New Departments Provisioned.
  * **Biometric Imports:** Counts Valid Logs Imported, Duplicate Logs Skipped, and Unknown Records Dropped.
* **Interactive Analytical Charts:** Utilizes `Chart.js` to render daily average work trends and status distributions, programmatically ignoring non-numeric string flags (`Not Checked Out`/`Not Checked In`) to maintain accurate global metrics without `NaN` execution breaks.

### 🔐 **Information Privacy & Administrative Security**
* **Local Workspace Isolation:** Operates fully within a localized boundary (`localhost:3000`). Corporate data rows never cross the public internet or external cloud services, safeguarding internal files.
* **Cryptographic Credential Salting:** Protects active user credentials with 10 rounds of dynamic asymmetric salting via `bcryptjs`.
* **Immutable Compliance Audit Logs:** Traps all critical session life cycles (logins, logouts, report exports) in an append-only, permanent auditing ledger (`data/session-audit.log`).
* **Non-Destructive Soft-Deactivations:** Replaces standard data erasure commands. Dropping an employee profile flips an `IsActive` bit flag to `0`, isolating access immediately while preserving historical logs for external regulatory audits.

---

## 🛠️ **Unified Technology Stack**

| Architecture Layer | Component Technology | Purpose |
| :--- | :--- | :--- |
| **Backend Runtime** | Node.js | Asynchronous, event-driven server engine |
| **Web Framework** | Express.js | Core MVC routing and REST API framework |
| **Database Engine** | Microsoft SQL Server (MSSQL) | Centralized relational data warehouse |
| **File Stream Interceptor** | Multer | High-speed, in-memory multi-part form data buffer |
| **Spreadsheet Compiler** | SheetJS (`xlsx`) | Binary parsing library for Excel/CSV data matrices |
| **Cryptographic Toolkit** | Bcryptjs | 10-round structural password salting utility |
| **Frontend Layout Interface** | HTML5 / CSS3 / Bootstrap 5 | Mobile-responsive, user-centric view engine |
| **Data Analytics View** | Chart.js | Asynchronous client-side data rendering |

---

## 🔑 **Presentation Authentication Credentials**

For system defense evaluation, hackathon reviews, and testing, use the following default access accounts:

### 🛠️ **1. Administrator Dashboard Access**
* **Role/Privilege:** Full System Administrator (Roster ingestion, upload access, analytics override, audit review)
* **Access Username:** `ADMIN001`
* **Secure Access Password:** `Admin@123`

### 👥 **2. Standard Staff Account**
* **Role/Privilege:** General Corporate Employee (Personal profile overview, shift review)
* **Access Username:** `USER001`
* **Secure Access Password:** `user@123`

> 🔒 *Security Note: All user credentials undergo a 10-round dynamic cryptographic salting routine via `bcryptjs` before storage in the Microsoft SQL Server database layer. Plaintext passwords are never saved.*

---

## 📊 **Database Schema Topology**

The database architecture is fully normalized and organized across three interconnected tracking units:

1. **`Departments` Table:** A static lookup directory tracking unique business unit codes and department labels.
2. **`Users` Table:** The structural roster backbone storing names, employment types, active states, and matching relational department keys.
3. **`AttendanceLogs` Table:** A high-speed transaction tier storing the individual raw badge swipes.

                  ┌──────────────────────────────────────────┐
                  │               DEPARTMENTS                │
                  ├──────────────────────────────────────────┤
                  │ PK │ DepartmentID (int, auto_increment)  │
                  │    │ DepartmentName (nvarchar)           │
                  └─────────────────┬────────────────────────┘
                                    │
                                    │ 1:N Relation
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                       USERS                                          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ PK │ EmployeeNo   (nvarchar, unique staff string backbone)                           │
│ FK │ DepartmentID (int, references Departments)                                      │
│    │ FirstName    (nvarchar, stores empty string for unified multi-initial profiles) │
│    │ LastName     (nvarchar, preserves full untruncated name input strings)          │
│    │ EmpType      (nvarchar, tracks Permanent / Contractor status)                   │
│    │ PasswordHash (nvarchar, encrypted bcrypt string)                                 │
│    │ IsActive     (bit, soft-delete control switch)                                  │
└──────────────────────────────────────────┬────────────────────────────────___________┘
                                           │
                                           │ 1:N Relation
                                           ▼
                  ┌──────────────────────────────────────────┐
                  │             ATTENDANCELOGS               │
                  ├──────────────────────────────────────────┤
                  │ PK │ LogID        (bigint, identity)     │
                  │ FK │ EmployeeNo   (nvarchar, matches Users)│
                  │    │ LogDate      (date)                 │
                  │    │ LogTime      (time)                 │
                  │    │ DeviceName   (nvarchar)             │
                  └──────────────────────────────────────────┘

Whenever the analytics dashboard loads, it executes a strict **SQL `INNER JOIN`** query across all three tables, binding biometric log entries directly to active roster structures to generate up-to-the-minute metrics:

```sql
SELECT a.EmployeeNo, u.FirstName, u.LastName, d.DepartmentName, u.EmpType, a.LogDate, a.LogTime 
FROM AttendanceLogs a
INNER JOIN Users u ON a.EmployeeNo = u.EmployeeNo
INNER JOIN Departments d ON u.DepartmentID = d.DepartmentID
WHERE u.IsActive = 1;
```
🚀 Environment Deployment & Local Setup
1. Repository Installation
Navigate into your local project directory and run the initialization build command:
```Bash
npm install
```

2. Physical Schema Setup
Open your database controller (SQL Server Management Studio, Azure Data Studio, or command-line sqlcmd). Execute the schema building and setup files in order from the repository base:

```Bash
# Initialize base configuration settings and clear old states
sqlcmd -S localhost -U sa -P YourPassword -i database/01-create-database.sql

# Create normalized table structures, indexes, and self-healing columns
sqlcmd -S localhost -U sa -P YourPassword -i database/02-create-schema.sql

# Seed system core permissions and administrative credentials
sqlcmd -S localhost -U sa -P YourPassword -i database/03-seed-data.sql
```
3. Environment Variable Configuration
Verify your local .env parameters match your physical server connection routes:

```Bash
Properties
DB_SERVER=localhost
DB_DATABASE=attendance
DB_USER=sa
DB_PASSWORD=YourPassword123
DB_PORT=1433
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
```
4. Run the Platform
Boot the platform interface. For active development with real-time change tracking and code reloads, execute:

```Bash
npm run dev
```