'use strict';

const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: node scripts/set-bank-admin.js <firebase-auth-uid>');
  process.exitCode = 1;
} else {
  initializeApp({
    credential: applicationDefault(),
    projectId: 'dholakpur-bank',
  });
  const auth = getAuth();
  auth.getUser(uid)
    .then(user => auth.setCustomUserClaims(uid, {
      ...user.customClaims,
      bankRole: 'BANK_ADMIN',
    }))
    .then(() => console.log(`Granted Dholakpur Bank admin role to ${uid}. Ask the user to sign out and back in.`))
    .catch(error => {
      console.error('Unable to grant the bank-admin role:', error.message);
      process.exitCode = 1;
    });
}
