const cookie = require('cookie');

const REFERRAL_COOKIE_NAME = 'referral_code';
const MAX_AGE_DAYS = 90;

function referralHandler(req, res, next) {
  let referralCode = null;

  // 1. Check for /ref/:code, /referral/:code, or /:spell/ref/:code
  const pathParts = req.path.split('/').filter(p => p);
  const refIndex = pathParts.findIndex(p => p === 'ref' || p === 'referral');

  if (refIndex !== -1 && refIndex + 1 < pathParts.length) {
    referralCode = pathParts[refIndex + 1];

    // Redirect to the path before the /ref(erral)/ segment
    const refSegment = pathParts[refIndex]; // 'ref' or 'referral'
    const originalPath = req.path;
    const cutAt = originalPath.indexOf(`/${refSegment}/`);
    const newPath = cutAt > 0 ? originalPath.substring(0, cutAt) : '/';

    res.cookie(REFERRAL_COOKIE_NAME, referralCode, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000, // 90 days
      sameSite: 'lax',
      ...(process.env.NODE_ENV === 'production' && { domain: '.noema.art' })
    });

    return res.redirect(newPath);
  }

  // 2. Check for query parameter ?ref=code
  if (req.query.ref) {
    referralCode = req.query.ref;
  }

  // If a referral code is found from any source, set it in the cookie
  if (referralCode) {
    res.cookie(REFERRAL_COOKIE_NAME, referralCode, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000, // 90 days
      sameSite: 'lax',
      ...(process.env.NODE_ENV === 'production' && { domain: '.noema.art' })
    });
  }

  next();
}

module.exports = {
  referralHandler
}; 