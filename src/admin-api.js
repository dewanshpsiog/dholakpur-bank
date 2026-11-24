const adminBase = import.meta.env.VITE_BANK_API_URL ||
  'https://us-central1-dholakpur-bank.cloudfunctions.net/bankApi';

async function adminRequest(path, token, options = {}) {
  const headers = { 'Authorization': `Bearer ${token}` };
  if (options.body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${adminBase.replace(/\/$/, '')}${path}`, { ...options, headers });
  } catch {
    throw new Error('Dholakpur Bank admin services are unreachable. Deploy the Firebase Functions backend.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message ||
    (response.status === 404 ? 'The Dholakpur Bank Functions are not deployed yet.' : `Admin request failed (${response.status}).`));
  return data;
}

export function getAdminSummary(token) {
  return adminRequest('/admin/summary', token);
}

export function getAdminApplications(token) {
  return adminRequest('/admin/applications', token);
}

export function getAdminCampaigns(token) {
  return adminRequest('/admin/campaigns', token);
}

export function createAdminCampaign(token, campaign) {
  return adminRequest('/admin/campaigns', token, { method: 'POST', body: JSON.stringify(campaign) });
}

export function getAdminLoanApplications(token) {
  return adminRequest('/admin/loan-applications', token);
}

export function reviewAdminLoanApplication(token, applicationId, status, reason = '') {
  return adminRequest(`/admin/loan-applications/${encodeURIComponent(applicationId)}/review`, token, {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  });
}

export function reviewAdminApplication(token, applicationId, status, reason = '') {
  return adminRequest(`/admin/applications/${encodeURIComponent(applicationId)}/review`, token, {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  });
}

export function saveTransferLimit(token, customerId, limitMinor) {
  return adminRequest(`/admin/customers/${encodeURIComponent(customerId)}/transfer-limit`, token, {
    method: 'POST',
    body: JSON.stringify({ limitMinor }),
  });
}

export function saveBank(token, bankData) {
  return adminRequest('/admin/banks', token, { method: 'POST', body: JSON.stringify(bankData) });
}

