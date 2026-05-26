const bcrypt = require('bcryptjs');

module.exports = {
  sessionSecret: 'antigravity-attendance-secret-key-2026',
  users: {
    admin: {
      username: 'admin',
      name: 'Administrator',
      role: 'Admin',
      passwordHash: bcrypt.hashSync('Admin@123', 10)
    },
    user: {
      username: 'user',
      name: 'Standard User',
      role: 'User',
      passwordHash: bcrypt.hashSync('User@123', 10)
    }
  }
};
