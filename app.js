const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Modular configuration imports
const { sessionSecret } = require('./config/auth');

// Modular middleware imports
const auditLogger = require('./middleware/auditLogger');

// Modular router imports
const authRouter = require('./routes/auth');
const attendanceRouter = require('./routes/attendance');
const exportRouter = require('./routes/export');
const usersRouter = require('./routes/users');


// Core express configs
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session setup
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 2 // 2 hours
  }
}));

// Mount audit logger globally
app.use(auditLogger);

// Get active session status
app.get('/api/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// Serve root redirect
app.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

// Mount modular routing layers
app.use(authRouter);
app.use(attendanceRouter);
app.use(exportRouter);
app.use(usersRouter);


// Start server
app.listen(PORT, () => {
  console.log(`Project Antigravity Server is running at http://localhost:${PORT}`);
});
