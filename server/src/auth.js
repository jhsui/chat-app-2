import jwt from 'jsonwebtoken';

export const COOKIE_NAME = 'token';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return 'dev-only-secret-change-me';
}

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), username: user.username }, getSecret(), {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

/** Returns the user id from a token, or null if it is missing or invalid. */
export function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getSecret());
    return Number(payload.sub);
  } catch {
    return null;
  }
}

export function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax' });
}

/** Express middleware: rejects the request unless a valid auth cookie is present. */
export function requireAuth(db) {
  return (req, res, next) => {
    const userId = verifyToken(req.cookies?.[COOKIE_NAME]);
    const user = userId && db.findUserById(userId);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    req.user = user;
    next();
  };
}
