module.exports = {
  requireLogin: (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (req.session.user.role !== 'Admin') {
      return res.redirect('/dashboard');
    }
    next();
  }
};
