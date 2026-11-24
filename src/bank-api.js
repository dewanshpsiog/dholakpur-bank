const bankApiBase = import.meta.env.VITE_BANK_API_URL ||
  'https://us-central1-dholakpur-bank.cloudfunctions.net/bankApi';

async function bankRequest(path, idToken, options = {}) {
  let response;
  try {
    response = await fetch(`${bankApiBase.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Dholakpur Bank services are unreachable. Deploy the Firebase Functions backend; login and KYC status remain available.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result.error?.message || result.message ||
      (response.status === 404 ? 'The Dholakpur Bank Functions are not deployed yet.' : `Bank operation failed (${response.status}).`);
    throw new Error(message);
  }
  return result;
}

export function getCustomerDashboard(idToken) {
  return bankRequest('/customer/dashboard', idToken);
}

export function submitInternalTransfer(idToken, transfer, idempotencyKey) {
  return bankRequest('/customer/transfers/internal', idToken, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(transfer),
  });
}

export function issueSandboxCard(idToken, accountId) {
  return bankRequest('/customer/cards', idToken, {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
}

export function updateSandboxCard(idToken, cardId, status) {
  return bankRequest(`/customer/cards/${encodeURIComponent(cardId)}/status`, idToken, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function submitLoanApplication(idToken, application) {
  return bankRequest('/customer/loans', idToken, {
    method: 'POST',
    body: JSON.stringify(application),
  });
}
