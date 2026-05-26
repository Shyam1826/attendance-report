const fs = require('fs');
const csv = require('csv-parser');

module.exports = {
  validateCSVHeaders: (filePath) => {
    return new Promise((resolve, reject) => {
      let headersValid = true;
      
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('headers', (headers) => {
          const required = ['EmployeeID', 'Name', 'Department', 'Timestamp'];
          const missing = required.filter(h => !headers.includes(h));
          if (missing.length > 0) {
            headersValid = false;
          }
          resolve(headersValid);
        })
        .on('error', (err) => {
          reject(err);
        });
    });
  }
};
