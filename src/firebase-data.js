import firebaseConfig from './firebase-config';

const firestoreBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents`;

function firestoreValue(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) return { integerValue: String(value) };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value && typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) } };
  }
  throw new Error('Unsupported customer profile value.');
}

async function firestoreRequest(path, idToken, options = {}) {
  if (!firebaseConfig.projectId) throw new Error('Set VITE_FIREBASE_PROJECT_ID to connect your bank database.');
  const response = await fetch(`${firestoreBase}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = result.error?.status;
    throw new Error(status === 'PERMISSION_DENIED'
      ? 'Firebase security rules denied this bank profile operation. Check the customer application rules.'
      : status === 'NOT_FOUND' ? 'No customer application is saved for this Firebase account.'
      : result.error?.message || `Firebase database request failed (${response.status}).`);
  }
  return result;
}

export async function uploadCustomerDocument({ idToken, uid, file }) {
  if (!firebaseConfig.storageBucket) throw new Error('Set VITE_FIREBASE_STORAGE_BUCKET before submitting KYC documents.');
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  if (!allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('Choose a PDF, JPG or PNG document no larger than 5 MB.');
  }
  const objectName = `customer_documents/${uid}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, '_')}`;
  const url = new URL(`https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o`);
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', objectName);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': file.type },
    body: file,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || 'KYC document upload failed.');
  return { objectName: result.name, contentType: result.contentType, size: Number(result.size) };
}

export async function createCustomerApplication({ idToken, uid, profile, document }) {
  return firestoreRequest(`customerApplications?documentId=${encodeURIComponent(uid)}`, idToken, {
    method: 'POST',
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries({
        uid,
        role: 'CUSTOMER',
        status: 'PENDING',
        profile,
        document,
        openingDepositMinor: 100000,
        createdAt: new Date(),
      }).map(([key, value]) => [key, firestoreValue(value)])),
    }),
  });
}

function decodeValue(value) {
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return value.doubleValue;
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, decodeValue(child)]));
  return null;
}

export async function getCustomerApplication(idToken, uid) {
  const doc = await firestoreRequest(`customerApplications/${encodeURIComponent(uid)}`, idToken);
  return Object.fromEntries(Object.entries(doc.fields || {}).map(([key, value]) => [key, decodeValue(value)]));
}

export async function downloadCustomerDocument(idToken, objectName) {
  if (!firebaseConfig.storageBucket) throw new Error('Firebase Storage is not configured.');
  const url = new URL(`https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${encodeURIComponent(objectName)}`);
  url.searchParams.set('alt', 'media');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!response.ok) throw new Error('Unable to access the KYC document. Check the bank-admin Storage rules.');
  return response.blob();
}
