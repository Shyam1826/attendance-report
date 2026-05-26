const fs = require('fs');
const path = require('path');

module.exports = (req, res, next) => {
  req.logExport = (format, filters) => {
    const user = req.session.user;
    if (!user) return;
    
    const logPath = path.join(__dirname, '..', 'data', 'audit.log');
    const dataDir = path.dirname(logPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
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
