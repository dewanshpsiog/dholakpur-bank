import firebaseConfig from './firebase-config';

function configured() {
  return Boolean(firebaseConfig.apiKey);
}

async function firebaseAuth(endpoint, body) {
  if (!configured()) throw new Error('Firebase REST authentication is not configured. Set VITE_FIREBASE_API_KEY.');
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await response.json();
  if (!response.ok) {
    const code = data.error?.message || 'AUTH_ERROR';
    throw new Error(code === 'EMAIL_NOT_FOUND' ? 'No account exists with this email.'
      : code === 'INVALID_PASSWORD' ? 'The password is incorrect.'
      : code === 'EMAIL_EXISTS' ? 'An account already exists with this email.'
      : code === 'INVALID_EMAIL' ? 'Enter a valid email address.'
      : code === 'TOO_MANY_ATTEMPTS_TRY_LATER' ? 'Too many attempts. Try again later.'
      : 'Authentication could not be completed. Please try again.');
  }
  return data;
}

export function firebaseRegister({ email, password }) {
  return firebaseAuth('signUp', { email, password, returnSecureToken: true });
}

export function firebaseSignIn({ email, password }) {
  return firebaseAuth('signInWithPassword', { email, password, returnSecureToken: true });
}

export function firebaseResetPassword(email) {
  return firebaseAuth('sendOobCode', { requestType: 'PASSWORD_RESET', email });
}

export function firebaseUpdatePassword(idToken, password) {
  return firebaseAuth('update', { idToken, password, returnSecureToken: true });
}

export async function firebaseGetAccountClaims(idToken) {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('Firebase returned an invalid ID token.');
  try {
    let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const claims = JSON.parse(decodeURIComponent(escape(atob(base64))));
    return { attributes: claims };
  } catch {
    throw new Error('Unable to read the Firebase account role.');
  }
}
