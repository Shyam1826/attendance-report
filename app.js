process.env.TZ = 'Asia/Kolkata'; // 🟢 Sets the runtime process timezone to IST locally
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();

// Single dynamic port definition for IIS / local fallback
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


// Serve root redirect and pull login directly from the views folder
app.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/dashboard');
  } else {
    // Send the physical login.html file straight from your views folder
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
  }
});

// Graceful legacy catch-all URL redirect for manual uploads
app.all(['/upload', '/api/upload'], (req, res) => {
  res.redirect('/dashboard');
});

// Mount modular routing layers
app.use(authRouter);
app.use(attendanceRouter);
app.use(exportRouter);
app.use(usersRouter);

// Start server exactly ONCE at the very bottom
app.listen(PORT, () => {
  console.log(`Server successfully launched. Active deployment listening on port: ${PORT}`);
});