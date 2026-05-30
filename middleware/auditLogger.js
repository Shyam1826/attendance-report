const fs = require('fs');
const path = require('path');

// Localized date-helper utility for Asia/Kolkata timezone with 24-hour formatting
function getKolkataTimestamp() {
  const date = new Date();
  const rawLocale = date.toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false
  });
  
  try {
    const [datePart, timePart] = rawLocale.split(', ');
    const [m, d, y] = datePart.split('/');
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${dd} ${timePart}`;
  } catch (err) {
    // Graceful fallback to ISO timestamp if formatting fails
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }
}

module.exports = (req, res, next) => {
  req.logExport = (format, filters) => {
    const user = req.session.user;
    if (!user) return;
    
    const logPath = path.join(__dirname, '..', 'data', 'audit.log');
    const dataDir = path.dirname(logPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const timestamp = getKolkataTimestamp();
    const filterStr = JSON.stringify(filters || {});
    const logLine = `[${timestamp}] USER: ${user.name} (ADID: ${user.username}) | ACTION: Export ${format.toUpperCase()} | FILTERS: ${filterStr}\n`;
    
    try {
      fs.appendFileSync(logPath, logLine);
    } catch (error) {
      console.error('Audit Logging Error:', error);
    }
  };
  next();
};
