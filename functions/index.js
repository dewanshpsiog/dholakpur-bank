'use strict';

const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { onRequest } = require('firebase-functions/v2/https');

initializeApp();
const auth = getAuth();
const db = getFirestore();
const BANK_ID = 'P653';
const DEFAULT_DAILY_LIMIT_MINOR = 5000000;

function send(res, status, body) {
  res.status(status).set('Content-Type', 'application/json').send(body);
}

async function authenticate(req, res, requireAdmin = false) {
  const header = req.get('Authorization') || '';
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    send(res, 401, { error: { message: 'Sign in to your Dholakpur Bank account.' } });
    return null;
  }
  try {
    const decoded = await auth.verifyIdToken(match[1]);
    const role = String(decoded.bankRole || decoded.role || '').toUpperCase();
    const isAdmin = role === 'BANK_ADMIN' || role === 'ADMIN';
    if (requireAdmin && !isAdmin) {
      send(res, 403, { error: { message: 'This action requires a Dholakpur Bank administrator.' } });
      return null;
    }
    return decoded;
  } catch {
    send(res, 401, { error: { message: 'Your bank session is invalid or expired. Sign in again.' } });
    return null;
  }
}

async function requireApprovedCustomer(uid, res) {
  const application = await db.collection('customerApplications').doc(uid).get();
  if (!application.exists || application.get('status') !== 'APPROVED') {
    send(res, 403, { error: { message: 'Your Dholakpur Bank KYC application is not approved.' } });
    return null;
  }
  return application;
}

function toTransferView(doc, uid) {
  const row = doc.data();
  return {
    transferId: doc.id,
    createdAt: row.createdAt?.toDate?.().toISOString() || null,
    amountMinor: row.amountMinor,
    status: row.status,
    direction: row.senderUid === uid ? 'DEBIT' : 'CREDIT',
    sourceBankId: BANK_ID,
    destinationBankId: BANK_ID,
    type: row.type || 'INTERNAL',
    sandbox: row.sandbox === true,
    sandboxAmountMinor: row.sandboxAmountMinor || 0,
    remarks: row.remarks || '',
  };
}

async function customerDashboard(req, res, user) {
  if (!await requireApprovedCustomer(user.uid, res)) return;
  const [accounts, transactions, notifications, cards, loans, campaigns] = await Promise.all([
    db.collection('accounts').where('ownerUid', '==', user.uid).get(),
    db.collection('transactions').where('ownerUids', 'array-contains', user.uid).limit(50).get(),
    db.collection('notifications').where('uid', '==', user.uid).limit(20).get(),
    db.collection('cards').where('ownerUid', '==', user.uid).get(),
    db.collection('loanApplications').where('ownerUid', '==', user.uid).get(),
    db.collection('campaigns').where('status', '==', 'ACTIVE').limit(50).get(),
  ]);
  const accountRows = accounts.docs.map(doc => ({ accountId: doc.id, ...doc.data() }));
  const transferRows = transactions.docs.map(doc => toTransferView(doc, user.uid))
    .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''));
  send(res, 200, {
    accounts: accountRows,
    transfers: transferRows,
    notifications: notifications.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.get('createdAt')?.toDate?.().toISOString() || null,
    })),
    cards: cards.docs.map(doc => ({ cardId: doc.id, ...doc.data() })),
    loans: loans.docs.map(doc => ({ applicationId: doc.id, ...doc.data() })),
    offers: campaigns.docs.map(doc => ({ offerId: doc.id, ...doc.data() }))
      .filter(offer => {
        const now = Date.now();
        return (!offer.startsAt || new Date(offer.startsAt).getTime() <= now) &&
          (!offer.expiresAt || new Date(offer.expiresAt).getTime() > now);
      }),
  });
}

async function internalTransfer(req, res, user) {
  if (!await requireApprovedCustomer(user.uid, res)) return;
  const { fromAccountId, destinationAccountNumber, amountMinor, currency, remarks = '' } = req.body || {};
  const idempotencyKey = req.get('Idempotency-Key');
  if (!fromAccountId || !destinationAccountNumber || !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0 || currency !== 'INR' || typeof remarks !== 'string' || remarks.length > 80 ||
      !idempotencyKey || idempotencyKey.length > 200) {
    send(res, 400, { error: { message: 'Check the account, INR amount, remarks and idempotency key.' } });
    return;
  }
  const keyHash = crypto.createHash('sha256').update(`${user.uid}:${idempotencyKey}`).digest('hex');
  const requestHash = crypto.createHash('sha256')
    .update(JSON.stringify([fromAccountId, String(destinationAccountNumber).trim(), amountMinor, currency, remarks]))
    .digest('hex');
  const idempotencyRef = db.collection('idempotencyKeys').doc(keyHash);
  const sourceRef = db.collection('accounts').doc(fromAccountId);
  const destinationQuery = db.collection('accounts')
    .where('accountNumber', '==', String(destinationAccountNumber).trim())
    .where('bankId', '==', BANK_ID)
    .limit(2);
  const txnRef = db.collection('transactions').doc();
  const debitRef = db.collection('ledgerEntries').doc(`${txnRef.id}_debit`);
  const creditRef = db.collection('ledgerEntries').doc(`${txnRef.id}_credit`);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const usageRef = db.collection('dailyTransferUsage').doc(`${user.uid}_${date}`);
  const applicationRef = db.collection('customerApplications').doc(user.uid);
  const now = FieldValue.serverTimestamp();

  try {
    const result = await db.runTransaction(async transaction => {
      const prior = await transaction.get(idempotencyRef);
      if (prior.exists) {
        if (prior.get('requestHash') !== requestHash) {
          throw Object.assign(new Error('This idempotency key was already used for different transfer details.'), { status: 409 });
        }
        return prior.get('result');
      }
      const [sourceSnap, destinationSnap, appSnap, usageSnap] = await Promise.all([
        transaction.get(sourceRef),
        transaction.get(destinationQuery),
        transaction.get(applicationRef),
        transaction.get(usageRef),
      ]);
      if (!sourceSnap.exists || sourceSnap.get('ownerUid') !== user.uid || sourceSnap.get('status') !== 'ACTIVE') {
        throw Object.assign(new Error('The source account is unavailable.'), { status: 422 });
      }
      if (destinationSnap.size !== 1) {
        throw Object.assign(new Error('The destination account is unavailable or ambiguous.'), { status: 422 });
      }
      const destinationDoc = destinationSnap.docs[0];
      if (destinationDoc.id === sourceSnap.id) {
        throw Object.assign(new Error('Choose a different destination account.'), { status: 422 });
      }
      if (destinationDoc.get('status') !== 'ACTIVE' || !destinationDoc.get('ownerUid') ||
          !Number.isSafeInteger(destinationDoc.get('availableMinor')) || destinationDoc.get('availableMinor') < 0) {
        throw Object.assign(new Error('The destination account is not active.'), { status: 422 });
      }
      const balance = sourceSnap.get('availableMinor');
      const destinationBalance = destinationDoc.get('availableMinor');
      const sourceSandboxBalance = sourceSnap.get('sandboxAvailableMinor') || 0;
      const destinationSandboxBalance = destinationDoc.get('sandboxAvailableMinor') || 0;
      const usedToday = usageSnap.exists ? usageSnap.get('usedMinor') : 0;
      const configuredLimit = appSnap.get('transferLimitMinor');
      const limitMinor = Number.isSafeInteger(configuredLimit) ? configuredLimit : DEFAULT_DAILY_LIMIT_MINOR;
      if (!Number.isSafeInteger(sourceSandboxBalance) || sourceSandboxBalance < 0 || sourceSandboxBalance > balance ||
          !Number.isSafeInteger(destinationSandboxBalance) || destinationSandboxBalance < 0 || destinationSandboxBalance > destinationBalance) {
        throw Object.assign(new Error('The sandbox balance is inconsistent; contact the bank before transferring.'), { status: 409 });
      }
      if (!Number.isSafeInteger(balance) || balance < amountMinor) {
        throw Object.assign(new Error('Insufficient available balance.'), { status: 422 });
      }
      if (!Number.isSafeInteger(destinationBalance + amountMinor)) {
        throw Object.assign(new Error('The destination account cannot accept this amount.'), { status: 422 });
      }
      if (usedToday + amountMinor > limitMinor) {
        throw Object.assign(new Error('Your daily transfer limit would be exceeded.'), { status: 422 });
      }
      const sandboxAmountMinor = Math.min(amountMinor, sourceSandboxBalance);
      if (!Number.isSafeInteger(destinationSandboxBalance + sandboxAmountMinor)) {
        throw Object.assign(new Error('The destination sandbox balance cannot accept this amount.'), { status: 422 });
      }

      const row = {
        transferId: txnRef.id,
        fromAccountId: sourceSnap.id,
        toAccountId: destinationDoc.id,
        fromAccountNumber: sourceSnap.get('accountNumber'),
        toAccountNumber: destinationDoc.get('accountNumber'),
        senderUid: user.uid,
        recipientUid: destinationDoc.get('ownerUid'),
        ownerUids: [...new Set([user.uid, destinationDoc.get('ownerUid')])],
        amountMinor,
        sandboxAmountMinor,
        sandbox: sandboxAmountMinor > 0,
        currency: 'INR',
        status: 'COMPLETED',
        type: 'INTERNAL',
        remarks,
        createdAt: now,
      };
      transaction.update(sourceRef, {
        availableMinor: balance - amountMinor,
        sandboxAvailableMinor: sourceSandboxBalance - sandboxAmountMinor,
        updatedAt: now,
      });
      transaction.update(destinationDoc.ref, {
        availableMinor: destinationBalance + amountMinor,
        sandboxAvailableMinor: destinationSandboxBalance + sandboxAmountMinor,
        updatedAt: now,
      });
      transaction.set(txnRef, row);
      transaction.create(debitRef, {
        transactionId: txnRef.id, accountId: sourceSnap.id, debitMinor: amountMinor, creditMinor: 0, createdAt: now,
      });
      transaction.create(creditRef, {
        transactionId: txnRef.id, accountId: destinationDoc.id, debitMinor: 0, creditMinor: amountMinor, createdAt: now,
      });
      transaction.set(usageRef, { usedMinor: usedToday + amountMinor, date, uid: user.uid });
      const response = {
        transferId: txnRef.id,
        status: 'COMPLETED',
        amountMinor,
        currency: 'INR',
        createdAt: new Date().toISOString(),
      };
      transaction.create(idempotencyRef, { uid: user.uid, requestHash, result: response, createdAt: now });
      return response;
    });
    send(res, 200, result);
  } catch (error) {
    send(res, error.status || 500, { error: { message: error.status ? error.message : 'The bank could not post this transfer. Check transaction activity before retrying.' } });
  }
}

async function issueSandboxCard(req, res, user) {
  if (!await requireApprovedCustomer(user.uid, res)) return;
  const { accountId } = req.body || {};
  if (typeof accountId !== 'string' || !accountId) {
    send(res, 400, { error: { message: 'Select an account for the sandbox card.' } });
    return;
  }
  const account = await db.collection('accounts').doc(accountId).get();
  if (!account.exists || account.get('ownerUid') !== user.uid || account.get('status') !== 'ACTIVE') {
    send(res, 403, { error: { message: 'The selected account is not available for this card.' } });
    return;
  }
  const ref = db.collection('cards').doc();
  const card = {
    ownerUid: user.uid,
    accountId,
    cardType: 'DEBIT',
    provider: 'SANDBOX',
    last4: String(crypto.randomInt(0, 10000)).padStart(4, '0'),
    status: 'ACTIVE',
    limitsMinor: { atm: 0, pos: 0, online: 0 },
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.create(card);
  send(res, 201, { cardId: ref.id, ...card, createdAt: new Date().toISOString() });
}

async function updateSandboxCard(req, res, user, cardId) {
  if (!await requireApprovedCustomer(user.uid, res)) return;
  const { status } = req.body || {};
  if (!['ACTIVE', 'BLOCKED'].includes(status)) {
    send(res, 400, { error: { message: 'Sandbox cards can only be activated or blocked.' } });
    return;
  }
  const ref = db.collection('cards').doc(cardId);
  const card = await ref.get();
  if (!card.exists || card.get('ownerUid') !== user.uid || card.get('provider') !== 'SANDBOX') {
    send(res, 404, { error: { message: 'Sandbox card was not found.' } });
    return;
  }
  await ref.update({ status, updatedAt: FieldValue.serverTimestamp() });
  send(res, 200, { cardId, status });
}

async function submitLoan(req, res, user) {
  if (!await requireApprovedCustomer(user.uid, res)) return;
  const { loanType, amountMinor, tenureMonths } = req.body || {};
  const loanTypes = ['PERSONAL', 'HOME', 'VEHICLE', 'EDUCATION', 'BUSINESS'];
  if (!loanTypes.includes(loanType) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
      !Number.isInteger(tenureMonths) || tenureMonths < 1 || tenureMonths > 360) {
    send(res, 400, { error: { message: 'Enter a supported loan type, positive amount and tenure between 1 and 360 months.' } });
    return;
  }
  const application = await db.collection('loanApplications').add({
    ownerUid: user.uid,
    email: user.email || '',
    loanType,
    amountMinor,
    tenureMonths,
    status: 'PENDING',
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection('notifications').add({
    uid: user.uid,
    type: 'LOAN_APPLICATION',
    status: 'PENDING',
    message: 'Your loan application was submitted for Dholakpur Bank review.',
    createdAt: FieldValue.serverTimestamp(),
  });
  send(res, 201, { applicationId: application.id, status: 'PENDING' });
}

async function listApplications(res) {
  const rows = await db.collection('customerApplications')
    .where('status', 'in', ['PENDING', 'HOLD'])
    .limit(100)
    .get();
  send(res, 200, {
    applications: rows.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      name: doc.get('profile.name') || '',
      email: doc.get('profile.email') || '',
    })),
  });
}

async function listLoanApplications(res) {
  const rows = await db.collection('loanApplications')
    .where('status', 'in', ['PENDING', 'HOLD'])
    .limit(100)
    .get();
  send(res, 200, {
    applications: rows.docs.map(doc => ({ applicationId: doc.id, ...doc.data() })),
  });
}

async function reviewLoanApplication(req, res, adminUser, applicationId) {
  const { status, reason = '' } = req.body || {};
  if (!['APPROVED', 'HOLD', 'REJECTED'].includes(status) || typeof reason !== 'string' || reason.length > 500) {
    send(res, 400, { error: { message: 'Choose APPROVED, HOLD or REJECTED and provide a valid reason.' } });
    return;
  }
  const ref = db.collection('loanApplications').doc(applicationId);
  const auditRef = db.collection('auditLogs').doc();
  const notificationRef = db.collection('notifications').doc();
  try {
    await db.runTransaction(async transaction => {
      const application = await transaction.get(ref);
      if (!application.exists || !['PENDING', 'HOLD'].includes(application.get('status'))) {
        throw Object.assign(new Error('An open loan application was not found.'), { status: 404 });
      }
      const now = FieldValue.serverTimestamp();
      transaction.update(ref, {
        status,
        reviewReason: reason,
        reviewedBy: adminUser.uid,
        reviewedAt: now,
      });
      transaction.create(auditRef, {
        actorUid: adminUser.uid,
        action: `LOAN_APPLICATION_${status}`,
        targetId: applicationId,
        reason,
        createdAt: now,
      });
      transaction.create(notificationRef, {
        uid: application.get('ownerUid'),
        type: 'LOAN_REVIEW',
        status,
        message: `Your ${application.get('loanType')} loan application status is ${status.toLowerCase()}.`,
        createdAt: now,
      });
    });
  } catch (error) {
    send(res, error.status || 500, { error: { message: error.status ? error.message : 'Unable to review this loan application.' } });
    return;
  }
  send(res, 200, { applicationId, status });
}

async function reviewApplication(req, res, adminUser, applicationId) {
  const { status, reason = '' } = req.body || {};
  if (!['APPROVED', 'HOLD', 'REJECTED'].includes(status) || typeof reason !== 'string' || reason.length > 500) {
    send(res, 400, { error: { message: 'Choose APPROVED, HOLD or REJECTED and provide a valid reason.' } });
    return;
  }
  const applicationRef = db.collection('customerApplications').doc(applicationId);
  const accountRef = db.collection('accounts').doc(crypto.randomUUID());
  const openingTransactionRef = db.collection('transactions').doc();
  const openingDebitRef = db.collection('ledgerEntries').doc(`${openingTransactionRef.id}_debit`);
  const openingCreditRef = db.collection('ledgerEntries').doc(`${openingTransactionRef.id}_credit`);
  const auditRef = db.collection('auditLogs').doc();
  try {
    await db.runTransaction(async transaction => {
      const application = await transaction.get(applicationRef);
      if (!application.exists) throw Object.assign(new Error('Customer application was not found.'), { status: 404 });
      if (!['PENDING', 'HOLD'].includes(application.get('status'))) {
        throw Object.assign(new Error('This application has already been reviewed.'), { status: 409 });
      }
      const now = FieldValue.serverTimestamp();
      const update = {
        status,
        reviewReason: reason,
        reviewedBy: adminUser.uid,
        reviewedAt: now,
      };
      if (status === 'APPROVED') {
        const openingDepositMinor = application.get('openingDepositMinor');
        if (openingDepositMinor !== 100000) {
          throw Object.assign(new Error('The sandbox opening deposit must be exactly ₹1,000.'), { status: 422 });
        }
        const accountNumber = `${BANK_ID}${crypto.randomInt(1000000000, 9999999999)}`;
        update.accountId = accountRef.id;
        transaction.create(accountRef, {
          ownerUid: applicationId,
          bankId: BANK_ID,
          accountNumber,
          accountType: 'SAVINGS',
          status: 'ACTIVE',
          availableMinor: openingDepositMinor,
          sandboxAvailableMinor: openingDepositMinor,
          heldMinor: 0,
          openingDepositRequestedMinor: openingDepositMinor,
          openingDepositCreditedMinor: openingDepositMinor,
          openingDepositMode: 'SANDBOX',
          createdAt: now,
          updatedAt: now,
        });
        transaction.create(openingTransactionRef, {
          transferId: openingTransactionRef.id,
          fromAccountId: 'SANDBOX_FUNDING',
          toAccountId: accountRef.id,
          toAccountNumber: accountNumber,
          recipientUid: applicationId,
          ownerUids: [applicationId],
          amountMinor: openingDepositMinor,
          sandboxAmountMinor: openingDepositMinor,
          currency: 'INR',
          status: 'COMPLETED',
          type: 'SANDBOX_OPENING_DEPOSIT',
          sandbox: true,
          remarks: 'Simulated sandbox opening credit; not real funds.',
          createdAt: now,
        });
        transaction.create(openingDebitRef, {
          transactionId: openingTransactionRef.id,
          accountId: 'SANDBOX_FUNDING',
          ledgerAccountType: 'SANDBOX_FUNDING',
          debitMinor: openingDepositMinor,
          creditMinor: 0,
          sandbox: true,
          createdAt: now,
        });
        transaction.create(openingCreditRef, {
          transactionId: openingTransactionRef.id,
          accountId: accountRef.id,
          debitMinor: 0,
          creditMinor: openingDepositMinor,
          sandbox: true,
          createdAt: now,
        });
      }
      transaction.update(applicationRef, update);
      transaction.create(db.collection('notifications').doc(), {
        uid: applicationId,
        type: 'KYC_REVIEW',
        status,
        message: status === 'APPROVED'
          ? 'Your Dholakpur Bank KYC is approved. A simulated ₹1,000 sandbox opening credit (not real funds) has been added, and you can now sign in.'
          : status === 'HOLD'
            ? 'Your Dholakpur Bank KYC needs additional review.'
            : 'Your Dholakpur Bank KYC application was not approved.',
        createdAt: now,
      });
      transaction.create(auditRef, {
        actorUid: adminUser.uid,
        action: `CUSTOMER_APPLICATION_${status}`,
        targetId: applicationId,
        reason,
        ...(status === 'APPROVED' && { openingDepositMode: 'SANDBOX', openingDepositMinor: 100000 }),
        createdAt: now,
      });
    });
    send(res, 200, { applicationId, status });
  } catch (error) {
    send(res, error.status || 500, { error: { message: error.status ? error.message : 'Unable to review this application.' } });
  }
}

async function adminSummary(res) {
  const [applications, accounts, transactions] = await Promise.all([
    db.collection('customerApplications').where('status', '==', 'APPROVED').get(),
    db.collection('accounts').get(),
    db.collection('transactions').get(),
  ]);
  send(res, 200, {
    customers: applications.size,
    depositsMinor: accounts.docs.reduce((sum, doc) => sum + (doc.get('availableMinor') || 0), 0),
    transactions: transactions.size,
  });
}

async function setTransferLimit(req, res, customerId) {
  const { limitMinor } = req.body || {};
  if (!Number.isSafeInteger(limitMinor) || limitMinor < 0) {
    send(res, 400, { error: { message: 'Transfer limit must be a non-negative integer number of paise.' } });
    return;
  }
  const ref = db.collection('customerApplications').doc(customerId);
  if (!(await ref.get()).exists) {
    send(res, 404, { error: { message: 'Customer application was not found.' } });
    return;
  }
  await ref.update({ transferLimitMinor: limitMinor, updatedAt: FieldValue.serverTimestamp() });
  send(res, 200, { customerId, limitMinor });
}

async function saveBank(req, res, adminUser) {
  const { bankId, bankName, ifsc, address } = req.body || {};
  if (![bankId, bankName, ifsc, address].every(value => typeof value === 'string' && value.trim())) {
    send(res, 400, { error: { message: 'Bank ID, name, IFSC and address are required.' } });
    return;
  }
  await db.collection('bankDirectory').doc(ifsc.trim().toUpperCase()).set({
    bankId: bankId.trim(),
    bankName: bankName.trim(),
    ifsc: ifsc.trim().toUpperCase(),
    address: address.trim(),
    updatedBy: adminUser.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  send(res, 200, { bankId, ifsc: ifsc.trim().toUpperCase() });
}

async function adminCampaigns(res) {
  const rows = await db.collection('campaigns').limit(100).get();
  send(res, 200, { campaigns: rows.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
}

async function saveCampaign(req, res, adminUser) {
  const { title, description, code, discountLabel, status, startsAt, expiresAt } = req.body || {};
  const start = Date.parse(startsAt);
  const end = Date.parse(expiresAt);
  if ([title, description, code, discountLabel].some(value => typeof value !== 'string' || !value.trim()) ||
      typeof code !== 'string' || !/^[A-Z0-9_-]{3,30}$/.test(code) ||
      !['DRAFT', 'ACTIVE'].includes(status) ||
      !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    send(res, 400, { error: { message: 'Enter valid campaign details, a 3–30 character coupon code and an end date after the start date.' } });
    return;
  }
  const id = code.trim().toUpperCase();
  await db.collection('campaigns').doc(id).set({
    title: title.trim(),
    description: description.trim(),
    code: id,
    discountLabel: discountLabel.trim(),
    status,
    startsAt: new Date(start).toISOString(),
    expiresAt: new Date(end).toISOString(),
    updatedBy: adminUser.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection('auditLogs').add({
    actorUid: adminUser.uid,
    action: 'CAMPAIGN_SAVED',
    targetId: id,
    createdAt: FieldValue.serverTimestamp(),
  });
  send(res, 200, { id, status });
}

exports.bankApi = onRequest({ region: 'us-central1', cors: true, maxInstances: 10 }, async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  const pathname = new URL(req.url, 'https://localhost').pathname.replace(/^\/bankApi/, '') || '/';
  try {
    if (req.method === 'GET' && pathname === '/customer/dashboard') {
      const user = await authenticate(req, res);
      if (user) await customerDashboard(req, res, user);
      return;
    }
    if (req.method === 'POST' && pathname === '/customer/transfers/internal') {
      const user = await authenticate(req, res);
      if (user) await internalTransfer(req, res, user);
      return;
    }
    if (req.method === 'POST' && pathname === '/customer/cards') {
      const user = await authenticate(req, res);
      if (user) await issueSandboxCard(req, res, user);
      return;
    }
    const cardStatusMatch = pathname.match(/^\/customer\/cards\/([^/]+)\/status$/);
    if (req.method === 'POST' && cardStatusMatch) {
      const user = await authenticate(req, res);
      if (user) await updateSandboxCard(req, res, user, decodeURIComponent(cardStatusMatch[1]));
      return;
    }
    if (req.method === 'POST' && pathname === '/customer/loans') {
      const user = await authenticate(req, res);
      if (user) await submitLoan(req, res, user);
      return;
    }
    if (pathname.startsWith('/admin/')) {
      const user = await authenticate(req, res, true);
      if (!user) return;
      if (req.method === 'GET' && pathname === '/admin/summary') return await adminSummary(res);
      if (req.method === 'GET' && pathname === '/admin/applications') return await listApplications(res);
      if (req.method === 'GET' && pathname === '/admin/loan-applications') return await listLoanApplications(res);
      if (req.method === 'GET' && pathname === '/admin/campaigns') return await adminCampaigns(res);
      if (req.method === 'POST' && pathname === '/admin/campaigns') return await saveCampaign(req, res, user);
      const loanReviewMatch = pathname.match(/^\/admin\/loan-applications\/([^/]+)\/review$/);
      if (req.method === 'POST' && loanReviewMatch) return await reviewLoanApplication(req, res, user, decodeURIComponent(loanReviewMatch[1]));
      const reviewMatch = pathname.match(/^\/admin\/applications\/([^/]+)\/review$/);
      if (req.method === 'POST' && reviewMatch) return await reviewApplication(req, res, user, decodeURIComponent(reviewMatch[1]));
      const limitMatch = pathname.match(/^\/admin\/customers\/([^/]+)\/transfer-limit$/);
      if (req.method === 'POST' && limitMatch) return await setTransferLimit(req, res, decodeURIComponent(limitMatch[1]));
      if (req.method === 'POST' && pathname === '/admin/banks') return await saveBank(req, res, user);
    }
    send(res, 404, { error: { message: 'Bank API route was not found.' } });
  } catch (error) {
    console.error('Dholakpur Bank API error', error);
    send(res, 500, { error: { message: 'The bank service could not complete this request.' } });
  }
});
