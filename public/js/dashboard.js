// B2B Dashboard Controller - Project Antigravity Production Edition

let lineChart = null;
let doughnutChart = null;
let currentRecords = [];
let currentPage = 1;
const rowsPerPage = 10;
let currentSortCol = null;
let currentSortDir = 'asc';

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  loadSession();
  setupEventListeners();
  fetchMasterDepartments(); 
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

async function fetchMasterDepartments() {
  try {
    const res = await fetch('/api/departments');
    const departmentsList = await res.json();
    
    const dropdown = document.getElementById('filter-department');
    dropdown.innerHTML = `<option value="">All Departments</option>`;
    
    departmentsList.forEach(dept => {
      const option = document.createElement('option');
      option.value = dept.DepartmentID; 
      option.textContent = dept.DepartmentName;
      dropdown.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading master departments list:', error);
  }
}

function setupEventListeners() {
  document.getElementById('filter-from-date').addEventListener('change', fetchDashboardData);
  document.getElementById('filter-to-date').addEventListener('change', fetchDashboardData);
  document.getElementById('filter-department').addEventListener('change', fetchDashboardData);
  document.getElementById('filter-status').addEventListener('change', fetchDashboardData);
  
  let searchTimeout = null;
  const triggerDebouncedSearch = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      fetchDashboardData();
    }, 300);
  };

  document.getElementById('filter-search').addEventListener('input', triggerDebouncedSearch);
  document.getElementById('attendance-search').addEventListener('input', triggerDebouncedSearch);

  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    document.getElementById('filter-from-date').value = '';
    document.getElementById('filter-to-date').value = '';
    document.getElementById('filter-department').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-search').value = '';
    document.getElementById('attendance-search').value = '';
    fetchDashboardData();
  });

  document.getElementById('export-excel-btn').addEventListener('click', () => handleExport('excel'));
  document.getElementById('export-pdf-btn').addEventListener('click', () => handleExport('pdf'));

  document.querySelectorAll('thead th[data-column]').forEach(th => {
    th.addEventListener('click', () => {
      const columnKey = th.getAttribute('data-column');
      handleSort(columnKey);
    });
  });
}

function getQueryParameters() {
  const params = new URLSearchParams();
  const startDate = document.getElementById('filter-from-date').value;
  const endDate = document.getElementById('filter-to-date').value;
  const deptId = document.getElementById('filter-department').value;
  const status = document.getElementById('filter-status').value;
  const empId = document.getElementById('filter-search').value || document.getElementById('attendance-search').value;

  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  if (deptId) params.append('departmentId', deptId);
  if (status && status !== 'All') params.append('status', status);
  if (empId) params.append('employeeId', empId.trim());

  return params.toString();
}

async function fetchDashboardData() {
  showLoader(true);
  try {
    const queryString = getQueryParameters();
    const response = await fetch(`/api/attendance?${queryString}`);
    const data = await response.json();

    currentRecords = data.records || [];
    currentPage = 1; 

    currentSortCol = null;
    currentSortDir = 'asc';
    updateSortIndicators();

    updateSummaryWidgets(currentRecords, data.doughnutChart || {});
    renderTable(currentRecords);
    
    updateDashboardCharts(data.lineChart || [], data.doughnutChart || {});

    calculateAndRenderSummary();

  } catch (error) {
    console.error('Production data fetch failed:', error);
  } finally {
    showLoader(false);
  }
}

function handleSort(columnKey) {
  if (currentSortCol === columnKey) {
    currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortCol = columnKey;
    currentSortDir = 'asc';
  }

  currentRecords.sort((a, b) => {
    if (columnKey === 'Date') {
      return currentSortDir === 'asc' ? a.Date.localeCompare(b.Date) : b.Date.localeCompare(a.Date);
    }

    let valA = a[columnKey];
    let valB = b[columnKey];

    if (columnKey === 'TotalHours') {
      const numA = parseFloat(valA) || 0;
      const numB = parseFloat(valB) || 0;
      return currentSortDir === 'asc' ? numA - numB : numB - numA;
    }

    const strA = String(valA).toLowerCase().trim();
    const strB = String(valB).toLowerCase().trim();

    if (strA < strB) return currentSortDir === 'asc' ? -1 : 1;
    if (strA > strB) return currentSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  currentPage = 1; 
  renderTable(currentRecords);
  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll('thead th[data-column]').forEach(th => {
    const columnKey = th.getAttribute('data-column');
    let baseText = '';
    const textNodes = th.childNodes;
    for (let i = 0; i < textNodes.length; i++) {
      if (textNodes[i].nodeType === Node.TEXT_NODE) baseText += textNodes[i].textContent;
    }
    baseText = baseText.trim();

    let iconClass = 'bi-arrow-down-up opacity-20';
    if (currentSortCol === columnKey) {
      iconClass = currentSortDir === 'asc' ? 'bi-arrow-up-short text-primary opacity-100 fw-bold' : 'bi-arrow-down-short text-primary opacity-100 fw-bold';
    }
    th.innerHTML = `${baseText} <span class="ms-1"><i class="bi ${iconClass}"></i></span>`;
  });
}

// 🟢 RECONFIGURED CLOCK-IN COLORS: Dynamic HR grace periods (9:10 AM is exactly Green)
function getInTimeColor(timeStr) {
  if (!timeStr || timeStr === '-' || timeStr.toLowerCase().includes('missing')) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2) return '';
  
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const totalMins = hours * 60 + minutes;

  // 07:00 AM to 08:44 AM (420 to 524 minutes) -> text-primary
  if (totalMins >= 420 && totalMins <= 524) return 'text-primary';
  // 08:45 AM to 09:10 AM (525 to 550 minutes) -> text-success
  if (totalMins >= 525 && totalMins <= 550) return 'text-success';
  // 09:11 AM to 09:45 AM (551 to 585 minutes) -> text-warning
  if (totalMins >= 551 && totalMins <= 585) return 'text-warning';
  // 09:46 AM or later (>= 586 minutes) -> text-danger
  if (totalMins >= 586) return 'text-danger';
  return '';
}

// 🟢 RECONFIGURED CLOCK-OUT COLORS: Dynamic HR departure windows
function getOutTimeColor(timeStr) {
  if (!timeStr || timeStr === '-' || timeStr.toLowerCase().includes('missing')) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2) return '';
  
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const totalMins = hours * 60 + minutes;

  // Before 05:45 PM (< 1065 minutes) -> text-danger
  if (totalMins < 1065) return 'text-danger';
  // 05:45 PM to 05:59 PM (1065 to 1079 minutes) -> text-warning
  if (totalMins >= 1065 && totalMins <= 1079) return 'text-warning';
  // 06:00 PM to 06:59 PM (1080 to 1139 minutes) -> text-success
  if (totalMins >= 1080 && totalMins <= 1139) return 'text-success';
  // 07:00 PM or later (>= 1140 minutes) -> text-primary
  if (totalMins >= 1140) return 'text-primary';
  return '';
}

function renderTable(records) {
  const tbody = document.getElementById('attendance-table-body');
  tbody.innerHTML = '';

  const total = records.length;
  if (total === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-center text-muted py-4">
          <i class="bi bi-folder-x fs-2 d-block mb-2 text-secondary"></i>
          No records found inside production query logs.
        </td>
      </tr>
    `;
    document.getElementById('pagination-info').textContent = 'Showing 0 to 0 of 0 entries';
    document.getElementById('pagination-controls').innerHTML = '';
    return;
  }

  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = Math.min(startIndex + rowsPerPage, total);
  const pageRecords = records.slice(startIndex, endIndex);

  pageRecords.forEach(row => {
    const tr = document.createElement('tr');
    
    // ONLY 'Incomplete Record' receives a colored table-danger highlight.
    // Normal rows, late entries, and early departures must remain completely transparent.
    if ((row.Status || '').toUpperCase() === 'INCOMPLETE RECORD') {
      tr.classList.add('table-danger');
    }

    const name = row.Name || 'Unassigned User';
    let nameCellContent = `<span class="fw-semibold text-dark">${name}</span>`;
    const department = row.Department || 'Unassigned';
    const date = row.Date || '-';

    // ─── TOTAL HOURS WORKED VISUAL HIGHLIGHTS MAPPING ───
    let hoursCellContent = '';
    if (row.TotalHours === '-') {
      hoursCellContent = `<span class="fw-bold text-secondary">Incomplete</span>`;
    } else {
      const hoursNum = parseFloat(row.TotalHours);
      let hoursClass = 'text-danger'; // <8 hours (Red)
      if (hoursNum >= 10.00) {
        hoursClass = 'text-info';      // 10+ hours (Cyan)
      } else if (hoursNum >= 9.00) {
        hoursClass = 'text-success';   // 9+ hours (Green)
      } else if (hoursNum >= 8.00) {
        hoursClass = 'text-warning';   // 8-9 hours (Yellow)
      }
      hoursCellContent = `<span class="fw-bold font-monospace ${hoursClass}">${row.TotalHours} hrs</span>`;
    }

    // ─── DETAILED VISUAL STATUS BADGES MAPPING ───
    let badgeClass = 'bg-secondary';
    switch ((row.Status || '').toUpperCase()) {
      case 'ONTIME':
        badgeClass = 'bg-success';
        break;
      case 'EARLY_DEPARTURE':
      case 'LATE_ENTRY_AND_LATE_EXIT':
        badgeClass = 'bg-warning text-dark';
        break;
      case 'LATE_ENTRY_AND_EARLY_EXIT':
        badgeClass = 'bg-danger';
        break;
      case 'OVERTIME':
        badgeClass = 'bg-info text-dark';
        break;
      case 'INCOMPLETE RECORD':
        badgeClass = 'bg-secondary';
        break;
    }
    const statusBadge = `<span class="badge ${badgeClass} font-monospace" style="font-size: 0.8rem;">${row.Status}</span>`;

    const firstInColor = getInTimeColor(row.FirstIn);
    const lastOutColor = getOutTimeColor(row.LastOut);

    const firstInCell = firstInColor ? `<span class="${firstInColor} font-monospace fw-semibold">${row.FirstIn}</span>` : `<span class="text-dark font-monospace fw-semibold">${row.FirstIn || '-'}</span>`;
    const lastOutCell = lastOutColor ? `<span class="${lastOutColor} font-monospace fw-semibold">${row.LastOut}</span>` : `<span class="text-dark font-monospace fw-semibold">${row.LastOut || '-'}</span>`;

    tr.innerHTML = `
      <td class="font-monospace fw-bold small">${row.EmployeeID || 'UNKNOWN'}</td>
      <td class="fw-semibold text-dark">${nameCellContent}</td>
      <td><span class="text-secondary">${department}</span></td>
      <td><span class="text-secondary fw-medium">${row.EmpType || 'N/A'}</span></td>
      <td><span class="font-monospace text-secondary">${date}</span></td>
      <td><span class="font-monospace text-secondary">${row.Weekday || 'N/A'}</span></td>
      <td>${firstInCell}</td>
      <td>${lastOutCell}</td>
      <td>${hoursCellContent}</td>
      <td>${statusBadge}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-primary d-flex align-items-center gap-1 font-monospace mx-auto" onclick="viewTimeline('${row.EmployeeID}', '${name.replace(/'/g, "\\\\'")}', '${row.Date}', '${row.FirstIn}', '${row.LastOut}')">
          <i class="bi bi-clock-history"></i> View Timeline
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('pagination-info').textContent = `Showing ${startIndex + 1} to ${endIndex} of ${total} entries`;
  renderPaginationControls(total);
}

function renderPaginationControls(totalRecords) {
  const controls = document.getElementById('pagination-controls');
  controls.innerHTML = '';

  const totalPages = Math.ceil(totalRecords / rowsPerPage);
  if (totalPages <= 1) return;

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

  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

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

function updateSummaryWidgets(records, doughnutChart) {
  const uniqueEmpsAll = new Set(records.map(r => r.EmployeeID));
  document.getElementById('widget-total-employees').textContent = uniqueEmpsAll.size;
  document.getElementById('widget-present-today').textContent = records.length;

  // Count Incomplete Record from records array directly
  const infractions = records.filter(r => (r.Status || '').toUpperCase() === 'INCOMPLETE RECORD').length;
  document.getElementById('widget-violations-today').textContent = infractions;

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

function updateDashboardCharts(lineData, doughnutData) {
  renderLineChart(lineData || []);
  renderDoughnutChart(doughnutData || {});
}

function renderLineChart(dataPoints) {
  const ctx = document.getElementById('lineChartCanvas').getContext('2d');
  if (lineChart) lineChart.destroy();

  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dataPoints.map(dp => dp.date),
      datasets: [{
        label: 'Daily Average Work Hours',
        data: dataPoints.map(dp => dp.avgHours),
        borderColor: '#495057', 
        backgroundColor: 'rgba(73, 80, 87, 0.04)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.15,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: function(context) {
          const val = context.raw;
          if (val >= 10.0) return '#0dcaf0'; // Cyan
          if (val >= 9.0) return '#198754';  // Green
          if (val >= 8.0) return '#ffc107';  // Yellow
          return '#dc3545';                  // Red
        },
        pointBorderColor: function(context) {
          const val = context.raw;
          if (val >= 10.0) return '#0dcaf0'; 
          if (val >= 9.0) return '#198754';  
          if (val >= 8.0) return '#ffc107';  
          return '#dc3545';                  
        },
        segment: {
          borderColor: function(ctx) {
            if (ctx && ctx.p1 && ctx.p1.parsed && typeof ctx.p1.parsed.y !== 'undefined') {
              const val = ctx.p1.parsed.y;
              if (val >= 10.0) return '#0dcaf0'; 
              if (val >= 9.0) return '#198754';  
              if (val >= 8.0) return '#ffc107';  
              return '#dc3545';                  
            }
            return '#dc3545';
          }
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: 'rgba(0, 0, 0, 0.03)' } },
        y: { 
          min: 0, 
          max: 14, 
          grid: { color: 'rgba(0, 0, 0, 0.03)' } 
        }
      }
    }
  });
}

function renderDoughnutChart(distribution) {
  const ctx = document.getElementById('doughnutChartCanvas').getContext('2d');
  if (doughnutChart) doughnutChart.destroy();

  const categories = ['ONTIME', 'OVERTIME', 'LATE_ENTRY_AND_LATE_EXIT', 'LATE_ENTRY_AND_EARLY_EXIT', 'EARLY_DEPARTURE'];
  
  const chartLabels = [];
  const chartValues = [];
  const statusColors = {
    'ONTIME': '#198754', // Green
    'OVERTIME': '#0dcaf0', // Cyan
    'LATE_ENTRY_AND_LATE_EXIT': '#ffc107', // Yellow
    'EARLY_DEPARTURE': '#ffc107', // Yellow
    'LATE_ENTRY_AND_EARLY_EXIT': '#dc3545' // Red
  };
  
  const bgColors = [];
  
  categories.forEach(cat => {
    const val = distribution && distribution[cat] ? distribution[cat] : 0;
    chartLabels.push(cat);
    chartValues.push(val);
    bgColors.push(statusColors[cat]);
  });

  doughnutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: chartLabels,
      datasets: [{
        data: chartValues,
        backgroundColor: bgColors,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
      }
    }
  });
}


async function handleExport(format) {
  const queryString = getQueryParameters();
  if (format === 'excel') {
    window.location.href = `/api/export?format=excel&${queryString}`;
    showExportNotification('Excel Secure download stream initiated.');
  } else if (format === 'pdf') {
    showExportNotification('Compiling full multi-page report asset...');
    window.print();
  }
}

function showLoader(visible) {
  const loader = document.getElementById('table-loader');
  if (loader) {
    visible ? loader.classList.remove('d-none') : loader.classList.add('d-none');
  }
}

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

// 🟢 REWRITTEN CALCULATOR: HOURLY DURATION COMPLIANCE METRIC (16/18 hrs = 88.9%)
window.calculateAndRenderSummary = function() {
  const summaryBody = document.getElementById('employee-summary-body');
  if (!summaryBody) return;
  summaryBody.innerHTML = '';

  if (currentRecords.length === 0) {
    summaryBody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted py-4">No records loaded to summarize.</td>
      </tr>
    `;
    return;
  }

  const summaries = {};
  currentRecords.forEach(rec => {
    const empId = rec.EmployeeID || rec.EmployeeNo || 'UNKNOWN';
    if (!summaries[empId]) {
      summaries[empId] = {
        EmployeeID: empId,
        Name: rec.Name || 'Standard Employee',
        TotalDays: 0,
        TotalHoursWorked: 0,
        LateCount: 0,
        EarlyCount: 0
      };
    }
    
    const sumObj = summaries[empId];
    sumObj.TotalDays += 1;
    
    const parsedHours = parseFloat(rec.TotalHours);
    if (!isNaN(parsedHours)) {
      sumObj.TotalHoursWorked += parsedHours;
    }
    
    const testStatus = (rec.Status || '').toUpperCase();
    if (testStatus.includes('LATE_ENTRY')) {
      sumObj.LateCount += 1;
    }
    if (testStatus.includes('EARLY_EXIT') || testStatus === 'EARLY_DEPARTURE') {
      sumObj.EarlyCount += 1;
    }
  });

  const sortedSummaries = Object.values(summaries).sort((a, b) => a.EmployeeID.localeCompare(b.EmployeeID));

  sortedSummaries.forEach(row => {
    // Expected hours parameter rule: 9.00 hours per day present
    const totalExpectedHours = row.TotalDays * 9;
    
    // Calculate net duration percentage matrix
    let compliancePct = '0.0';
    if (totalExpectedHours > 0) {
      compliancePct = ((row.TotalHoursWorked / totalExpectedHours) * 100).toFixed(1);
    }
    
    // Constrain maximum view ceiling at 100.0%
    if (parseFloat(compliancePct) > 100.0) compliancePct = "100.0";

    // ONLY the Compliance Score receives a badge color assignment:
    // Green badge for >= 90%, yellow for 75-89%, red for < 75%
    let complianceBadgeClass = 'bg-success'; // default (>= 90%)
    const compPctNum = parseFloat(compliancePct);
    if (compPctNum < 75.0) {
      complianceBadgeClass = 'bg-danger';
    } else if (compPctNum < 90.0) {
      complianceBadgeClass = 'bg-warning text-dark';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-nowrap">${row.EmployeeID}</td>
      <td class="text-nowrap">${row.Name}</td>
      <td class="text-center">${row.TotalDays}</td>
      <td class="text-center">${row.LateCount}</td>
      <td class="text-center">${row.EarlyCount}</td>
      <td class="text-center text-nowrap">${row.TotalHoursWorked.toFixed(2)} / ${totalExpectedHours.toFixed(2)} hrs</td>
      <td class="text-center">
        <span class="badge ${complianceBadgeClass} px-3 py-1.5 fs-6 shadow-sm">${compliancePct}%</span>
      </td>
    `;
    summaryBody.appendChild(tr);
  });
};

window.viewTimeline = function(empId, name, date, firstIn, lastOut) {
  document.getElementById('modal-employee-name').textContent = name;
  document.getElementById('modal-employee-id').textContent = `ID: ${empId}`;
  document.getElementById('modal-date').textContent = `Date: ${date}`;
  
  const container = document.getElementById('modal-timeline-container');
  container.innerHTML = '';
  
  const firstInEl = document.createElement('div');
  firstInEl.className = 'mb-3 position-relative';
  firstInEl.innerHTML = `
    <div class="position-absolute bg-primary rounded-circle" style="width: 12px; height: 12px; left: -31px; top: 6px; border: 2px solid #fff;"></div>
    <div class="fw-bold text-dark">First Check In</div>
    <div class="text-secondary small font-monospace">${firstIn}</div>
  `;
  container.appendChild(firstInEl);
  
  if (lastOut && lastOut !== 'Missing Checkout' && lastOut !== '-') {
    const lastOutEl = document.createElement('div');
    lastOutEl.className = 'position-relative';
    lastOutEl.innerHTML = `
      <div class="position-absolute bg-success rounded-circle" style="width: 12px; height: 12px; left: -31px; top: 6px; border: 2px solid #fff;"></div>
      <div class="fw-bold text-dark">Last Check Out</div>
      <div class="text-secondary small font-monospace">${lastOut}</div>
    `;
    container.appendChild(lastOutEl);
  } else {
    const lastOutEl = document.createElement('div');
    lastOutEl.className = 'position-relative';
    lastOutEl.innerHTML = `
      <div class="position-absolute bg-danger rounded-circle" style="width: 12px; height: 12px; left: -31px; top: 6px; border: 2px solid #fff;"></div>
      <div class="fw-bold text-danger">Last Check Out</div>
      <div class="text-secondary small font-monospace text-danger">Missing checkout registration</div>
    `;
    container.appendChild(lastOutEl);
  }
  
  const modal = new bootstrap.Modal(document.getElementById('timelineModal'));
  modal.show();
};