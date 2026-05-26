// B2B Dashboard Controller - Project Antigravity

let lineChart = null;
let doughnutChart = null;
let allRecords = [];
let currentRecords = [];
let currentPage = 1;
const rowsPerPage = 10;
let currentSortCol = null;
let currentSortDir = 'asc';

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  loadSession();
  setupEventListeners();
  fetchDashboardData();
});

// Load Current User Session details
async function loadSession() {
  try {
    const res = await fetch('/api/session');
    const data = await res.json();
    if (data.loggedIn) {
      document.getElementById('user-profile-name').textContent = data.user.name;
      document.getElementById('user-profile-role').textContent = data.user.role;
      
      // Admin privilege visibility guard
      if (data.user.role === 'Admin') {
        const adminLinks = document.querySelectorAll('.admin-only');
        adminLinks.forEach(link => link.classList.remove('d-none'));
      }
    } else {
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('Session load error:', error);
  }
}

// Add Event Listeners for filters and buttons
function setupEventListeners() {
  // Filter Inputs - hook up to frontend filtering engine directly
  document.getElementById('filter-from-date').addEventListener('change', applyFrontendFilters);
  document.getElementById('filter-to-date').addEventListener('change', applyFrontendFilters);
  document.getElementById('filter-department').addEventListener('change', applyFrontendFilters);
  document.getElementById('filter-status').addEventListener('change', applyFrontendFilters);
  
  // Search Input with debounce
  let searchTimeout = null;
  document.getElementById('filter-search').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      applyFrontendFilters();
    }, 300);
  });

  // Live attendance-search text input listener
  document.getElementById('attendance-search').addEventListener('input', () => {
    applyFrontendFilters();
  });

  // Action Buttons: Real Stream Exports
  document.getElementById('export-excel-btn').addEventListener('click', () => handleExport('excel'));
  document.getElementById('export-pdf-btn').addEventListener('click', () => handleExport('pdf'));

  // Table Column Header Click Listeners for Sorting
  document.querySelectorAll('thead th[data-column]').forEach(th => {
    th.addEventListener('click', () => {
      const columnKey = th.getAttribute('data-column');
      handleSort(columnKey);
    });
  });
}

// Gather all filters from UI state
function getFilters() {
  return {
    fromDate: document.getElementById('filter-from-date').value,
    toDate: document.getElementById('filter-to-date').value,
    department: document.getElementById('filter-department').value,
    status: document.getElementById('filter-status').value,
    search: document.getElementById('filter-search').value,
    attendanceSearch: document.getElementById('attendance-search').value
  };
}

// Fetch dynamic aggregated records from server API
async function fetchDashboardData() {
  showLoader(true);
  try {
    const response = await fetch('/api/attendance');
    const data = await response.json();

    allRecords = data.records;
    currentPage = 1; // Reset pagination page to 1 on load

    // Reset column sorting states
    currentSortCol = null;
    currentSortDir = 'asc';
    updateSortIndicators();

    // Populate Filter options dynamically from the complete unfiltered list on initial load
    const departmentsList = [...new Set(allRecords.map(item => item.Department))].sort();
    const statusesList = [...new Set(allRecords.map(item => item.Status))].sort();

    const filters = getFilters();
    updateDropdownOptions('filter-department', departmentsList, filters.department);
    updateDropdownOptions('filter-status', statusesList, filters.status);

    // Apply filters locally on the frontend and render all views
    applyFrontendFilters();

  } catch (error) {
    console.error('Error fetching attendance logs:', error);
  } finally {
    showLoader(false);
  }
}

// Update filter options dynamically
function updateDropdownOptions(dropdownId, list, currentValue) {
  const dropdown = document.getElementById(dropdownId);
  const defaultText = dropdownId === 'filter-status' ? 'All Statuses' : 'All Departments';
  dropdown.innerHTML = `<option value="All">${defaultText}</option>`;

  list.forEach(item => {
    const option = document.createElement('option');
    option.value = item;
    option.textContent = item;
    if (item === currentValue) {
      option.selected = true;
    }
    dropdown.appendChild(option);
  });
}

// Frontend Filtering Engine
function applyFrontendFilters() {
  const filters = getFilters();
  let filtered = [...allRecords];

  // 1 & 2. Date Filter with explicit override rule
  const fromDateValue = filters.fromDate || '';
  const toDateValue = filters.toDate || '';

  filtered = filtered.filter(record => {
    let passFrom = fromDateValue === '' || record.rawDate >= fromDateValue;
    let passTo = toDateValue === '' || record.rawDate <= toDateValue;
    return passFrom && passTo;
  });

  // 3. Department Filter
  if (filters.department && filters.department !== 'All') {
    filtered = filtered.filter(row => row.Department.toLowerCase() === filters.department.toLowerCase());
  }

  // 4. Status Filter
  if (filters.status && filters.status !== 'All') {
    filtered = filtered.filter(row => row.Status.toLowerCase() === filters.status.toLowerCase());
  }

  // 5. Search Employee (Name or EmployeeID)
  if (filters.search && filters.search.trim() !== '') {
    const query = filters.search.toLowerCase().trim();
    filtered = filtered.filter(row => 
      row.Name.toLowerCase().includes(query) || 
      row.EmployeeID.toLowerCase().includes(query)
    );
  }

  // 6. Live Text Search Filter (Employee ID, First Name, Last Name, or Department)
  if (filters.attendanceSearch && filters.attendanceSearch.trim() !== '') {
    const query = filters.attendanceSearch.toLowerCase().trim();
    filtered = filtered.filter(row => {
      const matchID = String(row.EmployeeID).toLowerCase().includes(query);
      const matchFirst = String(row.FirstName || '').toLowerCase().includes(query);
      const matchLast = String(row.LastName || '').toLowerCase().includes(query);
      const matchDept = String(row.Department || '').toLowerCase().includes(query);
      return matchID || matchFirst || matchLast || matchDept;
    });
  }

  currentRecords = filtered;
  currentPage = 1; // Reset to page 1 on filter change

  // Update live widgets
  updateSummaryWidgets(currentRecords);

  // Render main data grid table
  renderTable(currentRecords);

  // Update Analytics charts dynamically based on active filtered list
  updateChartsDynamically(currentRecords);

  // Update Employee Summary if active
  const summaryTab = document.getElementById('summary-tab');
  if (summaryTab.classList.contains('active')) {
    calculateAndRenderSummary();
  }
}

// Update charts dynamically from current records list
function updateChartsDynamically(records) {
  // 1. Line Chart: Daily Attendance Trend
  const trendsByDay = {};
  records.forEach(item => {
    const day = item.Date; // DD-MM-YYYY
    const rawDay = item.rawDate; // YYYY-MM-DD
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
    .sort((a, b) => trendsByDay[a].rawDate.localeCompare(trendsByDay[b].rawDate))
    .map(day => {
      const dData = trendsByDay[day];
      const avgHours = dData.count > 0 ? parseFloat((dData.totalHours / dData.count).toFixed(2)) : 0;
      return {
        date: day,
        avgHours: avgHours,
        compliantCount: dData.compliantCount,
        lateCount: dData.lateCount
      };
    });

  renderLineChart(lineChartData);

  // 2. Doughnut Chart: Compliance Distribution
  const statusDistribution = {
    'Compliant': 0,
    'Late Arrival': 0,
    'Early Departure': 0,
    'Late & Early': 0,
    'Overtime': 0
  };
  records.forEach(item => {
    if (statusDistribution[item.Status] !== undefined) {
      statusDistribution[item.Status] += 1;
    }
  });

  renderDoughnutChart(statusDistribution);
}

// Interactive Sorting Logic (Client-Side for maximum responsiveness)
function handleSort(columnKey) {
  if (currentSortCol === columnKey) {
    // Toggle direction
    currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortCol = columnKey;
    currentSortDir = 'asc';
  }

  currentRecords.sort((a, b) => {
    // Chronological date sort using the rawDate YYYY-MM-DD
    if (columnKey === 'Date') {
      const strA = a.rawDate || '';
      const strB = b.rawDate || '';
      if (strA < strB) return currentSortDir === 'asc' ? -1 : 1;
      if (strA > strB) return currentSortDir === 'asc' ? 1 : -1;
      return 0;
    }

    let valA = a[columnKey];
    let valB = b[columnKey];

    // Numbers sort (Hours)
    if (columnKey === 'TotalHours') {
      const numA = parseFloat(valA) || 0;
      const numB = parseFloat(valB) || 0;
      return currentSortDir === 'asc' ? numA - numB : numB - numA;
    }

    // Default String comparison
    const strA = String(valA).toLowerCase().trim();
    const strB = String(valB).toLowerCase().trim();

    if (strA < strB) return currentSortDir === 'asc' ? -1 : 1;
    if (strA > strB) return currentSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  currentPage = 1; // Reset to page 1 on sort change
  renderTable(currentRecords);
  updateSortIndicators();
}

// Refreshes the B2B bootstrap icon sorting arrows
function updateSortIndicators() {
  document.querySelectorAll('thead th[data-column]').forEach(th => {
    const columnKey = th.getAttribute('data-column');
    
    // Extract base column header text
    let baseText = '';
    const textNodes = th.childNodes;
    for (let i = 0; i < textNodes.length; i++) {
      if (textNodes[i].nodeType === Node.TEXT_NODE) {
        baseText += textNodes[i].textContent;
      }
    }
    baseText = baseText.trim();

    let iconClass = 'bi-arrow-down-up opacity-20';
    if (currentSortCol === columnKey) {
      iconClass = currentSortDir === 'asc' ? 'bi-arrow-up-short text-primary opacity-100 fw-bold' : 'bi-arrow-down-short text-primary opacity-100 fw-bold';
    }

    th.innerHTML = `${baseText} <span class="ms-1"><i class="bi ${iconClass}"></i></span>`;
  });
}

// Render filtered aggregated records inside data grid (with client-side pagination)
function renderTable(records) {
  const tbody = document.getElementById('attendance-table-body');
  tbody.innerHTML = '';

  const total = records.length;
  if (total === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center text-muted py-4">
          <i class="bi bi-folder-x fs-2 d-block mb-2 text-secondary"></i>
          No records match the active filters.
        </td>
      </tr>
    `;
    document.getElementById('pagination-info').textContent = 'Showing 0 to 0 of 0 entries';
    document.getElementById('pagination-controls').innerHTML = '';
    return;
  }

  // Slicing for client-side pagination
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, total);
  const pageRecords = records.slice(startIndex, endIndex);

  pageRecords.forEach(row => {
    const tr = document.createElement('tr');
    
    // Conditional text colors for punch times based on standard boundaries (9:00 AM / 540m and 6:00 PM / 1080m)
    const firstInClass = row.FirstIn ? (row.rawFirstInMins <= 540 ? 'text-success' : 'text-danger') : 'text-muted';
    const lastOutClass = row.LastOut ? (row.rawLastOutMins >= 1080 ? 'text-success' : 'text-danger') : 'text-muted';

    // Refactored Total Hours text column color-coding independently of badges
    let hoursCellContent = '';
    if (row.TotalHours === 'Not Checked Out' || row.TotalHours === 'Not Checked In') {
      const badgeColorClass = row.TotalHours === 'Not Checked Out' ? 'text-warning' : 'text-danger';
      hoursCellContent = `<span class="fw-bold ${badgeColorClass}">${row.TotalHours}</span>`;
    } else {
      let hoursClass = 'text-dark';
      const hoursNum = parseFloat(row.TotalHours) || 0;
      if (hoursNum >= 10.0) {
        hoursClass = 'text-info'; // CYAN (Bootstrap text-info / custom cyan)
      } else if (hoursNum >= 9.0) {
        hoursClass = 'text-success'; // GREEN (Bootstrap text-success)
      } else if (hoursNum >= 8.0) {
        hoursClass = 'text-warning'; // YELLOW (Bootstrap text-warning)
      } else {
        hoursClass = 'text-danger'; // RED (Bootstrap text-danger)
      }
      hoursCellContent = `<span class="fw-bold font-monospace ${hoursClass}">${row.TotalHours} hrs</span>`;
    }

    tr.innerHTML = `
      <td class="font-monospace fw-bold small">${row.EmployeeID}</td>
      <td class="fw-semibold text-dark">${row.FirstName || ''}</td>
      <td class="fw-semibold text-dark">${row.LastName || ''}</td>
      <td><span class="text-secondary">${row.Department}</span></td>
      <td><span class="text-secondary fw-medium">${row.EmpType || 'N/A'}</span></td>
      <td><span class="font-monospace text-secondary">${row.Date}</span></td>
      <td><span class="font-monospace text-secondary">${row.Weekday || 'N/A'}</span></td>
      <td><span class="${firstInClass} font-monospace fw-semibold">${row.FirstIn || '-'}</span></td>
      <td><span class="${lastOutClass} font-monospace fw-semibold">${row.LastOut || '-'}</span></td>
      <td>${hoursCellContent}</td>
    `;
    tbody.appendChild(tr);
  });

  // Update Pagination Details and Controls
  document.getElementById('pagination-info').textContent = `Showing ${startIndex + 1} to ${endIndex} of ${total} entries`;
  renderPaginationControls(total);
}

// Render dynamic pagination numeric controls (truncated sliding window centering on active currentPage index)
function renderPaginationControls(totalRecords) {
  const controls = document.getElementById('pagination-controls');
  controls.innerHTML = '';

  const totalPages = Math.ceil(totalRecords / rowsPerPage);
  if (totalPages <= 1) return;

  // 1. First Page Button ("« First")
  const firstLi = document.createElement('li');
  firstLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
  firstLi.innerHTML = `<button class="page-link" type="button">« First</button>`;
  if (currentPage > 1) {
    firstLi.addEventListener('click', () => {
      currentPage = 1;
      renderTable(currentRecords);
    });
  }
  controls.appendChild(firstLi);

  // Centering sliding window math - maximum of 5 page number buttons centered around currentPage
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);

  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }

  // Preceding Ellipsis
  if (startPage > 1) {
    const dotsLi = document.createElement('li');
    dotsLi.className = 'page-item disabled';
    dotsLi.innerHTML = `<span class="page-link">...</span>`;
    controls.appendChild(dotsLi);
  }

  // Active numeric buttons
  for (let i = startPage; i <= endPage; i++) {
    const pageLi = document.createElement('li');
    pageLi.className = `page-item ${currentPage === i ? 'active' : ''}`;
    pageLi.innerHTML = `<button class="page-link" type="button">${i}</button>`;
    
    pageLi.addEventListener('click', () => {
      currentPage = i;
      renderTable(currentRecords);
    });
    controls.appendChild(pageLi);
  }

  // Succeeding Ellipsis
  if (endPage < totalPages) {
    const dotsLi = document.createElement('li');
    dotsLi.className = 'page-item disabled';
    dotsLi.innerHTML = `<span class="page-link">...</span>`;
    controls.appendChild(dotsLi);
  }

  // 2. Last Page Button ("Last »")
  const lastLi = document.createElement('li');
  lastLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
  lastLi.innerHTML = `<button class="page-link" type="button">Last »</button>`;
  if (currentPage < totalPages) {
    lastLi.addEventListener('click', () => {
      currentPage = totalPages;
      renderTable(currentRecords);
    });
  }
  controls.appendChild(lastLi);
}

// Live calculation and updates of summary card KPIs using exact formulas requested
function updateSummaryWidgets(records) {
  // If the complete registry isn't loaded yet, return early
  if (!allRecords || allRecords.length === 0) return;

  // 1. Total Employees: count of completely unique 'EmployeeID' profiles found across the entire dataset registry
  const uniqueEmpsAll = new Set(allRecords.map(r => r.EmployeeID));
  document.getElementById('widget-total-employees').textContent = uniqueEmpsAll.size;

  // 2. Present Today & 3. Violations Today: Evaluate using actual real-world system calendar date (YYYY-MM-DD)
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const presentTodaySet = new Set(
    allRecords.filter(r => r.rawDate === todayStr).map(r => r.EmployeeID)
  );
  document.getElementById('widget-present-today').textContent = presentTodaySet.size;

  let violationsToday = 0;
  allRecords.forEach(r => {
    if (r.rawDate === todayStr) {
      if (r.Status === 'Late Arrival' || r.Status === 'Early Departure' || r.Status === 'Late & Early') {
        violationsToday += 1;
      }
    }
  });
  document.getElementById('widget-violations-today').textContent = violationsToday;

  // 4. Avg Work Hours: Global arithmetic mean of all numeric Total Hours elements loaded (currently filtered records)
  let totalHours = 0;
  let numericCount = 0;
  records.forEach(r => {
    const parsed = parseFloat(r.TotalHours);
    if (!isNaN(parsed)) {
      totalHours += parsed;
      numericCount += 1;
    }
  });
  const avgHours = numericCount > 0 ? (totalHours / numericCount).toFixed(2) : '0.00';
  document.getElementById('widget-avg-hours').textContent = `${avgHours} hrs`;
}

// Detailed sequence timelines Modal popup details mapping
window.showTimelineModal = function(empId, name, date, punches) {
  document.getElementById('modal-employee-name').textContent = name;
  document.getElementById('modal-employee-id').textContent = `ID: ${empId}`;
  document.getElementById('modal-date').textContent = `Date: ${date}`;
  
  const container = document.getElementById('modal-timeline-container');
  container.innerHTML = '';
  
  if (!punches || punches.length === 0) {
    container.innerHTML = '<div class="text-muted italic">No punches captured for this record.</div>';
  } else {
    punches.forEach((punch, index) => {
      const label = index % 2 === 0 ? 'Punch IN' : 'Punch OUT';
      const textClass = index % 2 === 0 ? 'text-success' : 'text-primary';
      const icon = index % 2 === 0 ? 'bi-box-arrow-in-right' : 'bi-box-arrow-left';
      
      const point = document.createElement('div');
      point.className = 'timeline-point';
      point.innerHTML = `
        <div class="d-flex align-items-center justify-content-between">
          <div>
            <span class="fw-bold ${textClass}"><i class="bi ${icon} me-1"></i> ${label}</span>
            <span class="text-secondary small font-monospace ms-2">Sequence #${index + 1}</span>
          </div>
          <span class="badge bg-light text-dark font-monospace border">${punch}</span>
        </div>
      `;
      container.appendChild(point);
    });
  }
  
  const modal = new bootstrap.Modal(document.getElementById('timelineModal'));
  modal.show();
};

// TAB 2: Group and calculate dataset per employee dynamically from currently filtered records list
window.calculateAndRenderSummary = function() {
  const summaryBody = document.getElementById('employee-summary-body');
  summaryBody.innerHTML = '';

  if (currentRecords.length === 0) {
    summaryBody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center text-muted py-4">No records loaded to summarize.</td>
      </tr>
    `;
    return;
  }

  const summaries = {};
  currentRecords.forEach(rec => {
    const empId = rec.EmployeeID;
    if (!summaries[empId]) {
      summaries[empId] = {
        EmployeeID: empId,
        Name: rec.Name,
        TotalDays: 0,
        TotalHours: 0,
        LateArrivalCount: 0,
        EarlyDepartureCount: 0,
        CompliantDays: 0
      };
    }
    
    const sumObj = summaries[empId];
    sumObj.TotalDays += 1;
    sumObj.TotalHours += parseFloat(rec.TotalHours) || 0;
    
    if (rec.Status === 'Late Arrival' || rec.Status === 'Late & Early') {
      sumObj.LateArrivalCount += 1;
    }
    if (rec.Status === 'Early Departure' || rec.Status === 'Late & Early') {
      sumObj.EarlyDepartureCount += 1;
    }
    if (rec.Status === 'Compliant' || rec.Status === 'Overtime') {
      sumObj.CompliantDays += 1;
    }
  });

  const sortedSummaries = Object.values(summaries).sort((a, b) => a.EmployeeID.localeCompare(b.EmployeeID));

  sortedSummaries.forEach(row => {
    const avgHours = (row.TotalHours / row.TotalDays).toFixed(2);
    const compliancePct = ((row.CompliantDays / row.TotalDays) * 100).toFixed(1);
    
    let badgeBg = 'bg-danger';
    if (parseFloat(compliancePct) >= 90) {
      badgeBg = 'bg-success';
    } else if (parseFloat(compliancePct) >= 70) {
      badgeBg = 'bg-warning text-dark';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-monospace fw-bold small">${row.EmployeeID}</td>
      <td class="fw-semibold text-dark">${row.Name}</td>
      <td class="text-center fw-medium">${row.TotalDays}</td>
      <td class="text-center font-monospace fw-bold text-primary">${avgHours} hrs</td>
      <td class="text-center font-monospace fw-medium text-danger">${row.LateArrivalCount}</td>
      <td class="text-center font-monospace fw-medium text-danger">${row.EarlyDepartureCount}</td>
      <td class="text-center font-monospace fw-medium text-success">${row.CompliantDays}</td>
      <td class="text-center">
        <span class="badge ${badgeBg} px-2 py-1 font-monospace" style="font-size: 0.82rem;">
          ${compliancePct}%
        </span>
      </td>
    `;
    summaryBody.appendChild(tr);
  });
};

// Render Line Chart (Daily Attendance Trend - 3 Datasets Plot)
function renderLineChart(dataPoints) {
  const ctx = document.getElementById('lineChartCanvas').getContext('2d');
  
  if (lineChart) {
    lineChart.destroy();
  }

  const labels = dataPoints.map(dp => dp.date);
  const avgHoursData = dataPoints.map(dp => dp.avgHours);
  const compliantCountData = dataPoints.map(dp => dp.compliantCount);
  const lateCountData = dataPoints.map(dp => dp.lateCount);

  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Daily Average Work Hours',
          data: avgHoursData,
          borderColor: '#06b6d4', // CYAN
          backgroundColor: 'rgba(6, 182, 212, 0.08)',
          borderWidth: 2.5,
          pointBackgroundColor: '#06b6d4',
          pointBorderColor: '#ffffff',
          pointHoverRadius: 6,
          fill: true,
          tension: 0.2
        },
        {
          label: 'Daily Total Compliant Count',
          data: compliantCountData,
          borderColor: '#10b981', // GREEN
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#ffffff',
          pointHoverRadius: 6,
          fill: false,
          tension: 0.2
        },
        {
          label: 'Daily Total Late Arrival Count',
          data: lateCountData,
          borderColor: '#ef4444', // RED
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointBackgroundColor: '#ef4444',
          pointBorderColor: '#ffffff',
          pointHoverRadius: 6,
          fill: false,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#475569',
            font: { family: 'Outfit', size: 11 }
          }
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleFont: { family: 'Outfit' },
          bodyFont: { family: 'Inter' },
          callbacks: {
            label: function(context) {
              const label = context.dataset.label || '';
              const val = context.parsed.y;
              if (label.includes('Average')) {
                return ` Average Hours: ${val} hrs`;
              }
              return ` Count: ${val}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(0, 0, 0, 0.04)'
          },
          ticks: {
            color: '#475569',
            font: { family: 'Fira Code', size: 10 }
          }
        },
        y: {
          min: 0,
          grid: {
            color: 'rgba(0, 0, 0, 0.04)'
          },
          ticks: {
            color: '#475569',
            font: { family: 'Fira Code', size: 10 }
          }
        }
      }
    }
  });
}

// Render Doughnut Chart (Status Badges Breakdown)
function renderDoughnutChart(distribution) {
  const ctx = document.getElementById('doughnutChartCanvas').getContext('2d');
  
  if (doughnutChart) {
    doughnutChart.destroy();
  }

  const labels = Object.keys(distribution);
  const data = Object.values(distribution);

  doughnutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: [
          'rgba(5, 150, 105, 0.85)', // Compliant (Green)
          'rgba(217, 119, 6, 0.85)',  // Late Arrival (Amber)
          'rgba(202, 138, 4, 0.85)',   // Early Departure (Yellow)
          'rgba(220, 38, 38, 0.85)',   // Late & Early (Red)
          'rgba(37, 99, 235, 0.85)'   // Overtime (Blue)
        ],
        borderColor: '#ffffff',
        borderWidth: 2.5,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#475569',
            font: { family: 'Outfit', size: 11 },
            padding: 15
          }
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleFont: { family: 'Outfit' },
          bodyFont: { family: 'Inter' }
        }
      },
      cutout: '65%'
    }
  });
}

// Fixed Real Export Handler: Redirects query states to standard asset streaming download
async function handleExport(format) {
  const filters = getFilters();
  const queryParams = new URLSearchParams(filters);
  queryParams.append('format', format);

  if (format === 'excel') {
    window.location.href = `/api/export?${queryParams.toString()}`;
    showExportNotification('Excel CSV secure download stream initiated.');
  } else if (format === 'pdf') {
    try {
      const res = await fetch(`/api/export?${queryParams.toString()}`);
      const data = await res.json();
      if (data.success) {
        showExportNotification('PDF export recorded in audit log. Preparing print view...');
        setTimeout(() => {
          window.print();
        }, 800);
      }
    } catch (err) {
      console.error('PDF Export log failed:', err);
    }
  }
}

// Helper Loader
function showLoader(visible) {
  const loader = document.getElementById('table-loader');
  if (loader) {
    if (visible) {
      loader.classList.remove('d-none');
    } else {
      loader.classList.add('d-none');
    }
  }
}

// Audited export flash feedback notifications
function showExportNotification(msg) {
  const container = document.getElementById('notification-container');
  if (!container) return;
  const alertEl = document.createElement('div');
  alertEl.className = 'alert alert-glass-success py-2 px-3 m-0 shadow d-flex align-items-center gap-2';
  alertEl.style.fontSize = '0.85rem';
  alertEl.innerHTML = `<i class="bi bi-shield-check-fill fs-5"></i> <span>${msg}</span>`;
  
  container.appendChild(alertEl);
  setTimeout(() => {
    alertEl.style.opacity = '0';
    setTimeout(() => alertEl.remove(), 500);
  }, 4000);
}
