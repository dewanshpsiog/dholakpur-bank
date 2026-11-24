import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight, BadgeIndianRupee, Bell, CreditCard, Gift, Home, Landmark,
  LayoutDashboard, LogOut, ReceiptText, RefreshCw, ShieldCheck, UserRound,
  WalletCards,
} from 'lucide-react';
import { toPaise } from './amount';
import { firebaseGetAccountClaims, firebaseRegister, firebaseResetPassword, firebaseSignIn, firebaseUpdatePassword } from './firebase-auth';
import { createAdminCampaign, getAdminApplications, getAdminCampaigns, getAdminLoanApplications, getAdminSummary, reviewAdminApplication, reviewAdminLoanApplication, saveTransferLimit } from './admin-api';
import { configuredEndpoint, liveApi, readStorage, saveStorage } from './live-api';
import { getCustomerDashboard, issueSandboxCard, submitInternalTransfer, submitLoanApplication, updateSandboxCard } from './bank-api';
import { createCustomerApplication, downloadCustomerDocument, getCustomerApplication, uploadCustomerDocument } from './firebase-data';
import './live.css';

const money = minor => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);
const dateTime = value => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

const statusText = {
  PENDING: 'Pending', PROCESSING: 'Processing', COMPLETED: 'Completed',
  REJECTED: 'Rejected', MANUAL_REVIEW: 'Manual review',
};

function Logo() {
  return <div className="logo" aria-label="Dholakpur Bank">
    <span className="logo-mark">₹</span><span><strong>DHOLAKPUR</strong><small>APNA BANK</small></span>
  </div>;
}

function VillageArt({ compact = false }) {
  return <div className={`village-art ${compact ? 'compact' : ''}`} aria-hidden="true">
    <div className="sun" /><div className="hill hill-a" /><div className="hill hill-b" />
    <div className="house house-a"><i /><b /></div><div className="house house-b"><i /><b /></div>
    <div className="bank-house"><span>DHOLAKPUR BANK</span><i /><i /><i /></div>
  </div>;
}

function AuthScreen({ onCustomerSignIn, onCustomerRegister, onCustomerResumeApplication, onFirebaseAdminSignIn }) {
  const [mode, setMode] = useState('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [documentFile, setDocumentFile] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'register') {
        const result = await onCustomerRegister({
          email: email.trim(),
          password,
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          documentFile,
        });
        if (result?.resume) {
          setMode('resume');
          setNotice(result.message);
        } else {
          setNotice('Your KYC application was submitted to Dholakpur Bank. Sign-in will be enabled after a bank administrator approves it.');
        }
      } else if (mode === 'resume') {
        await onCustomerResumeApplication({
          email: email.trim(),
          password,
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          documentFile,
        });
        setMode('signin');
        setNotice('Your KYC application was submitted to Dholakpur Bank. Sign-in will be enabled after a bank administrator approves it.');
      } else if (mode === 'reset') {
        await firebaseResetPassword(email.trim());
        setNotice('If Firebase is configured for this project, a password-reset email has been requested.');
      } else if (mode === 'admin') {
        await onFirebaseAdminSignIn(email.trim(), password);
      } else {
        await onCustomerSignIn(email.trim(), password);
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPassword(''); setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-story">
      <div className="story-copy">
        <span className="eyebrow">WELCOME TO DHOLAKPUR</span>
        <h1>Banking for every <em>big dream.</em></h1>
        <p>Safe, simple and always close to home.</p>
      </div>
      <VillageArt />
    </section>
    <section className="auth-card">
      <Logo />
      <div className="auth-tabs">
        <button className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setError(''); }}>Sign in</button>
        <button className={mode === 'register' || mode === 'resume' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Register</button>
        <button className={mode === 'admin' ? 'active' : ''} onClick={() => { setMode('admin'); setError(''); }}>Bank Admin</button>
      </div>
      <form onSubmit={submit}>
        <h2>{mode === 'signin' ? 'Good to see you' : mode === 'register' ? 'Create your account' : mode === 'resume' ? 'Complete your KYC application' : mode === 'admin' ? 'Bank administrator' : 'Reset password'}</h2>
        {mode === 'admin' && <p className="network-note">Requires the Firebase custom claim <code>bankRole: BANK_ADMIN</code>. A Firestore role field is not sufficient.</p>}
        {(mode === 'register' || mode === 'resume') && <>
          <label>Full name<input value={name} onChange={e => setName(e.target.value)} required /></label>
          <label>Phone number<input type="tel" value={phone} onChange={e => setPhone(e.target.value)} required /></label>
          <label>Address<input value={address} onChange={e => setAddress(e.target.value)} required /></label>
          <label>KYC document<input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setDocumentFile(e.target.files?.[0] || null)} required /></label>
          <div className="network-note">Sandbox demo: approval adds a simulated ₹1,000 opening credit. It is not real money.</div>
        </>}
        <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        {mode !== 'reset' && <label>Password<input type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} required /></label>}
        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}
        <button className="primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in securely' : mode === 'register' ? 'Create account' : mode === 'resume' ? 'Submit KYC application' : mode === 'admin' ? 'Enter admin console' : 'Send reset link'}
        </button>
        {mode === 'signin' && <button type="button" className="link-button" onClick={() => setMode('reset')}>Forgot password?</button>}
        {(mode === 'reset' || mode === 'resume') && <button type="button" className="link-button" onClick={() => setMode('signin')}>Back to sign in</button>}
      </form>
      <p className="network-note"><ShieldCheck size={16} /> Your bank’s Firebase login is independent of other banks.</p>
    </section>
  </main>;
}

function Sidebar({ page, setPage, logout, bank, role }) {
  const customerItems = [
    ['home', LayoutDashboard, 'Overview'], ['transfer', ArrowLeftRight, 'Transfers'],
    ['cards', CreditCard, 'Cards'], ['loans', BadgeIndianRupee, 'Loans'],
    ['offers', Gift, 'Offers'], ['profile', UserRound, 'Profile'],
  ];
  const adminItems = [['admin', ShieldCheck, 'Bank overview']];
  const items = role === 'ADMIN' ? adminItems : customerItems;
  return <aside className="sidebar">
    <Logo />
    <nav>{items.map(([id, Icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
      <Icon size={20} /><span>{label}</span>
    </button>)}</nav>
    <button className="logout" onClick={logout}><LogOut size={18} /> Sign out</button>
  </aside>;
}

function Dashboard({ data, setPage }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const accounts = data.accounts || [];
  const transfers = data.transfers || [];
  const notifications = data.notifications || [];
  const total = accounts.reduce((sum, account) => sum + account.availableMinor, 0);
  const held = accounts.reduce((sum, account) => sum + account.heldMinor, 0);
  const sandboxBalance = accounts.reduce((sum, account) => sum + (account.sandboxAvailableMinor || 0), 0);
  const incoming = transfers.filter(row => row.direction === 'CREDIT').reduce((sum, row) => sum + row.amountMinor, 0);
  const outgoing = transfers.filter(row => row.direction !== 'CREDIT').reduce((sum, row) => sum + row.amountMinor, 0);

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">YOUR DHOLAKPUR BANK</span><h1>Namaste, welcome back</h1></div>
      <button className="icon-button" aria-label="Notifications" onClick={() => setNotificationsOpen(value => !value)}>
        <Bell size={20} />{notifications.length > 0 && <span className="notification-dot" />}
      </button>
    </div>
    {notificationsOpen && <section className="panel notification-panel"><header><div><h2>Bank notifications</h2><p>Updates from Dholakpur Bank</p></div></header>
      {notifications.length ? notifications.map(item => <p key={item.id}>{item.message}<small>{dateTime(item.createdAt)}</small></p>)
        : <p>No bank notifications yet.</p>}
    </section>}
    <section className="balance-hero">
      <div><span>Total available balance</span><strong>{accounts.length ? money(total) : '—'}</strong>
        <small>{accounts.length ? `${money(held)} held across ${accounts.length} account${accounts.length === 1 ? '' : 's'}${sandboxBalance ? ` · Includes simulated sandbox funds of ${money(sandboxBalance)} (not real funds)` : ''}` : 'No bank account has been issued yet'}</small></div>
      <button className="primary" onClick={() => setPage('transfer')}>Send money <ArrowLeftRight size={18} /></button>
      <VillageArt compact />
    </section>
    <div className="metric-grid">
      <article><span>Money in</span><strong className="green">{money(incoming)}</strong><small>Latest completed transfers</small></article>
      <article><span>Money out</span><strong>{money(outgoing)}</strong><small>Latest completed transfers</small></article>
      <article><span>Account application</span><strong>{data.application?.status || 'Not found'}</strong><small>Reviewed by your bank</small></article>
    </div>
    <div className="dashboard-grid">
      <section className="panel">
        <header><div><h2>My accounts</h2><p>Your bank accounts</p></div></header>
        {accounts.length ? <div className="account-list">{accounts.map(account => <div key={account.accountId}>
          <span className="account-icon"><Landmark size={18} /></span>
          <div><strong>{account.accountNumber}</strong><small>{account.accountId}</small></div>
          <b>{money(account.availableMinor)}</b>
        </div>)}</div> : <div className="empty-state"><WalletCards size={28} /><strong>{data.application?.status === 'PENDING' ? 'Application under review' : 'No account issued'}</strong><p>
          {data.application?.status === 'PENDING' ? 'Your account and requested opening deposit will be set up after approval.' : 'Your bank has not issued an account yet.'}
        </p></div>}
      </section>
      <section className="panel">
        <header><div><h2>Recent activity</h2><p>Latest transactions</p></div><button className="link-button" onClick={() => setPage('transfer')}>View all</button></header>
        {transfers.length ? <div className="transaction-list">{transfers.slice(0, 5).map(row => <div key={row.transferId}>
          <span className={row.direction === 'CREDIT' ? 'tx-icon credit' : 'tx-icon'}>{row.direction === 'CREDIT' ? '↓' : '↑'}</span>
          <div><strong>{row.transferId}</strong><small>{dateTime(row.createdAt)}{row.sandboxAmountMinor ? ` · Includes ${money(row.sandboxAmountMinor)} simulated funds (not real funds)` : ''}</small></div>
          <b className={row.direction === 'CREDIT' ? 'green' : ''}>{row.direction === 'CREDIT' ? '+' : '−'}{money(row.amountMinor)}</b>
        </div>)}</div> : <div className="empty-state"><ReceiptText size={28} /><strong>No transfers yet</strong></div>}
      </section>
    </div>
  </>;
}

function TransferPage({ bank, accounts, directory, setDirectory, session, base, refresh, setNotice }) {
  const [kind, setKind] = useState('internal');
  const [from, setFrom] = useState(accounts[0]?.accountId || '');
  const [destIfsc, setDestIfsc] = useState('');
  const [destAccount, setDestAccount] = useState('');
  const [amount, setAmount] = useState('200');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const routes = directory.filter(item => item.bankId !== bank.id && item.status === 'ACTIVE');
  const source = accounts.find(account => account.accountId === from);
  useEffect(() => {
    if (kind !== 'interbank' || directory.length) return undefined;
    const controller = new AbortController();
    liveApi(base, '/directory/banks', { signal: controller.signal })
      .then(value => {
        const banks = value.banks || [];
        setDirectory(banks);
        const firstRoute = banks.find(item => item.bankId !== bank.id && item.status === 'ACTIVE');
        if (firstRoute) setDestIfsc(firstRoute.ifsc);
      })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [kind, directory.length, base, setDirectory, bank.id]);

  useEffect(() => { if (!destIfsc && routes[0]) setDestIfsc(routes[0].ifsc); }, [routes, destIfsc]);

  async function submit(event) {
    event.preventDefault(); setError('');
    const amountMinor = toPaise(amount);
    if (!source || !destAccount.trim() || amountMinor === null || (kind === 'interbank' && !destIfsc)) {
      setError(kind === 'interbank' && !destIfsc
        ? 'Select an available destination bank before continuing.'
        : 'Choose an active source and enter a positive amount with no more than two decimals.');
      return;
    }
    if (kind === 'interbank' && (source.sandboxAvailableMinor || 0) > 0) {
      setError('This account contains simulated sandbox funds. Inter-bank transfers are disabled until its sandbox balance is zero.');
      return;
    }
    const transfer = {
      fromAccountId: from,
      destinationIfsc: kind === 'internal' ? bank.ifsc : destIfsc,
      destinationAccountNumber: destAccount.trim(),
      amountMinor,
      currency: 'INR',
      remarks: remarks.trim(),
    };
    const hashInput = JSON.stringify([session.uid, kind, transfer]);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput)));
    const requestId = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    const storageKey = `dholakpur-transfer-${requestId}`;
    const idempotencyKey = readStorage(sessionStorage, storageKey, null) || crypto.randomUUID();
    saveStorage(sessionStorage, storageKey, idempotencyKey);
    setBusy(true);
    try {
      const row = kind === 'internal'
        ? await submitInternalTransfer(session.token, transfer, idempotencyKey)
        : await liveApi(base, '/banks/' + bank.id + '/transfers', {
          token: session.token, data: transfer, key: idempotencyKey,
        });
      saveStorage(sessionStorage, storageKey, null);
      saveStorage(sessionStorage, 'x42-last-transfer-' + idempotencyKey, row);
      setNotice(row.status === 'COMPLETED'
        ? `Transfer completed · ${row.transferId}`
        : row.status === 'REJECTED'
          ? `Transfer rejected · ${row.transferId}`
          : `Transfer status: ${statusText[row.status] || row.status} · ${row.transferId}`);
      setDestAccount(''); await refresh();
    } catch (failure) {
      setError(failure.message);
      setNotice(`Transfer not confirmed. Retry these exact details to reuse request ID ${idempotencyKey}.`);
    } finally { setBusy(false); }
  }

  return <><div className="page-heading"><div><span className="eyebrow">SEND & RECEIVE</span><h1>Money transfer</h1></div></div>
    <section className="transfer-layout">
      <form className="panel transfer-form" onSubmit={submit}>
        <div className="segmented"><button type="button" className={kind === 'internal' ? 'active' : ''} onClick={() => setKind('internal')}>Within Dholakpur</button>
          <button type="button" className={kind === 'interbank' ? 'active' : ''} onClick={() => setKind('interbank')}>Other bank</button></div>
        <label>From account<select value={from} onChange={e => setFrom(e.target.value)}>
          {accounts.filter(account => account.status === 'ACTIVE').map(account => <option key={account.accountId} value={account.accountId}>
            {account.accountNumber} · {money(account.availableMinor)} available
          </option>)}
        </select></label>
        {kind === 'interbank' && (source?.sandboxAvailableMinor || 0) > 0 &&
          <div className="alert error">This account has simulated funds. It cannot send money to another bank.</div>}
        {kind === 'interbank' && <label>Destination bank<select value={destIfsc} onChange={e => setDestIfsc(e.target.value)}>
          {routes.map(route => <option key={route.ifsc} value={route.ifsc}>{route.bankName} · {route.ifsc}</option>)}
          {!routes.length && <option value="">Bank directory unavailable</option>}
        </select></label>}
        <label>Destination account number<input value={destAccount} onChange={e => setDestAccount(e.target.value)} required /></label>
        <label>Amount (INR)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
        <label>Remarks<input value={remarks} onChange={e => setRemarks(e.target.value)} maxLength={80} /></label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary" disabled={busy || !accounts.length || (kind === 'interbank' && (source?.sandboxAvailableMinor || 0) > 0)}>{busy ? 'Submitting…' : 'Review & transfer'}</button>
      </form>
      <aside className="transfer-tip"><VillageArt compact /><h3>Safe transfer guide</h3><p>We keep the idempotency key for uncertain or timed-out requests. Do not submit the transfer twice.</p></aside>
    </section>
  </>;
}

function CardsPage({ accounts, cards, session, refresh }) {
  const [accountId, setAccountId] = useState(accounts[0]?.accountId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!accounts.some(account => account.accountId === accountId)) {
      setAccountId(accounts.find(account => account.status === 'ACTIVE')?.accountId || '');
    }
  }, [accounts, accountId]);

  async function issueCard() {
    setBusy(true); setError('');
    try { await issueSandboxCard(session.token, accountId); await refresh(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function toggle(card) {
    setBusy(true); setError('');
    try {
      await updateSandboxCard(session.token, card.cardId, card.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE');
      await refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">DHOLAKPUR SANDBOX</span><h1>Cards</h1></div></div>
    <div className="sandbox"><ShieldCheck size={18} /> These are sandbox-only card records; they do not connect to ATM, POS or card networks.</div>
    {error && <div className="alert error global-error">{error}</div>}
    {(cards || []).length ? <div className="card-showcase">{cards.map(card =>
      <article key={card.cardId} className="bank-card debit">
        <span>DHOLAKPUR BANK · {card.status}</span><strong>•••• {card.last4}</strong><small>DEBIT · SANDBOX</small>
        <button className="card-control" disabled={busy} onClick={() => toggle(card)}>
          {card.status === 'ACTIVE' ? 'Block sandbox card' : 'Unblock sandbox card'}
        </button>
      </article>)}</div> : <section className="panel empty-state"><CreditCard size={28} /><strong>No sandbox cards</strong><p>Request a demo card to test bank-side card controls.</p></section>}
    <section className="panel card-request">
      <label>Linked account<select value={accountId} onChange={event => setAccountId(event.target.value)}>
        {accounts.filter(account => account.status === 'ACTIVE').map(account =>
          <option key={account.accountId} value={account.accountId}>{account.accountNumber}</option>)}
      </select></label>
      <button className="primary" onClick={issueCard} disabled={busy || !accountId}>{busy ? 'Saving…' : 'Issue sandbox card'}</button>
    </section>
  </>;
}

function CalculatorPage({ page, data, session, refresh }) {
  const [principal, setPrincipal] = useState(500000);
  const [rate, setRate] = useState(0);
  const [months, setMonths] = useState(60);
  const [loanType, setLoanType] = useState('PERSONAL');
  const [loanBusy, setLoanBusy] = useState(false);
  const [loanError, setLoanError] = useState('');
  const [loanNotice, setLoanNotice] = useState('');
  const monthlyRate = rate / 1200;
  const emi = monthlyRate ? principal * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1) : principal / months;

  if (page === 'loans') return <>
    <div className="page-heading"><div><span className="eyebrow">GROW WITH CONFIDENCE</span><h1>Loans</h1></div></div>
    <section className="panel calculator"><header><div><h2>EMI calculator</h2><p>Illustrative calculation only</p></div></header>
      <div className="calculator-grid">
        <label>Loan amount (₹)<input type="number" min="1000" value={principal} onChange={e => setPrincipal(Number(e.target.value) || 0)} /></label>
        <label>Annual interest (%)<input type="number" min="0" step="0.1" value={rate} onChange={e => setRate(Number(e.target.value) || 0)} /></label>
        <label>Tenure (months)<input type="number" min="1" value={months} onChange={e => setMonths(Number(e.target.value) || 1)} /></label>
        <div className="emi-result"><span>Estimated monthly EMI</span><strong>{emi ? money(Math.round(emi * 100)) : '₹0'}</strong></div>
      </div>
      <form className="loan-application-form" onSubmit={async event => {
        event.preventDefault(); setLoanError(''); setLoanNotice(''); setLoanBusy(true);
        try {
          const amountMinor = Math.round(principal * 100);
          if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !Number.isInteger(months) || months < 1 || months > 360) {
            throw new Error('Enter a valid loan amount and tenure between 1 and 360 months.');
          }
          const result = await submitLoanApplication(session.token, { loanType, amountMinor, tenureMonths: months });
          setLoanNotice(`Application submitted · ${result.applicationId}`);
          await refresh();
        } catch (failure) { setLoanError(failure.message); }
        finally { setLoanBusy(false); }
      }}>
        <label>Loan type<select value={loanType} onChange={e => setLoanType(e.target.value)}>
          {['PERSONAL', 'HOME', 'VEHICLE', 'EDUCATION', 'BUSINESS'].map(type => <option key={type}>{type}</option>)}
        </select></label>
        {loanError && <div className="alert error">{loanError}</div>}{loanNotice && <div className="alert success">{loanNotice}</div>}
        <button className="primary" disabled={loanBusy}>{loanBusy ? 'Submitting…' : 'Submit loan application'}</button>
      </form>
      <div className="sandbox"><ShieldCheck size={18} /> Enter an interest rate supplied by your bank. This calculator does not approve or disburse a loan.</div>
      <div className="account-list">{(data.loans || []).length ? data.loans.map(loan => <div key={loan.applicationId}>
        <span className="account-icon"><BadgeIndianRupee size={18} /></span>
        <div><strong>{loan.loanType || 'Loan application'}</strong><small>{loan.status} · {loan.applicationId}</small></div>
        <b>{money(loan.amountMinor || 0)}</b>
      </div>) : <div className="empty-state"><BadgeIndianRupee size={24} /><strong>No loan applications</strong><p>Loan applications are unavailable until your bank enables a lending service.</p></div>}</div>
    </section>
  </>;

  if (page === 'offers') return <>
    <div className="page-heading"><div><span className="eyebrow">DHOLAKPUR DEALS</span><h1>Offers & rewards</h1></div></div>
    {(data.offers || []).length ? <div className="offer-grid">{data.offers.map(offer => <article key={offer.offerId}>
      <span className="offer-tag">{offer.code || 'BANK OFFER'}</span><h2>{offer.title}</h2><p>{offer.description}</p>
      <strong>{offer.discountLabel || ''}</strong>
    </article>)}</div> : <section className="panel empty-state"><Gift size={28} /><strong>No active offers</strong><p>Offers shown here come from Dholakpur Bank’s active Firebase campaigns.</p></section>}
  </>;
  return null;
}

function ProfilePage({ session, onPasswordChange }) {
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  return <>
    <div className="page-heading"><div><span className="eyebrow">PERSONAL DETAILS</span><h1>Profile & security</h1></div></div>
    <section className="panel profile-panel">
      <div className="profile-avatar">{(session?.email || 'C')[0].toUpperCase()}</div>
      <div><h2>{session?.email || 'Customer'}</h2><p>Customer account • Dholakpur Bank</p></div>
      <form onSubmit={async event => {
        event.preventDefault(); setError(''); setNotice('');
        try { await onPasswordChange(password); setNotice('Password update requested with Firebase.'); setPassword(''); }
        catch (failure) { setError(failure.message); }
      }}>
        <label>New password<input type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
        <button className="primary">Change password</button>
      </form>
    </section>
  </>;
}

function AdminPage({ session }) {
  const [summary, setSummary] = useState(null);
  const [applications, setApplications] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [limitRupees, setLimitRupees] = useState('50000');
  const [kycUrl, setKycUrl] = useState('');
  const [kycBusy, setKycBusy] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [loanApplications, setLoanApplications] = useState([]);
  const [campaign, setCampaign] = useState({ title: '', description: '', code: '', discountLabel: '', startsAt: '', expiresAt: '', status: 'DRAFT' });

  useEffect(() => {
    if (!session?.token) return;
    Promise.all([getAdminSummary(session.token), getAdminApplications(session.token), getAdminCampaigns(session.token), getAdminLoanApplications(session.token)])
      .then(([summaryValue, applicationValue, campaignValue, loanValue]) => {
        setSummary(summaryValue);
        setApplications(applicationValue.applications || applicationValue || []);
        setCampaigns(campaignValue.campaigns || []);
        setLoanApplications(loanValue.applications || []);
        setError('');
      })
      .catch(failure => setError(failure.message));
  }, [session]);

  async function review(applicationId, status) {
    setError(''); setMessage('');
    try {
      await reviewAdminApplication(session.token, applicationId, status);
      const [summaryValue, applicationValue] = await Promise.all([
        getAdminSummary(session.token), getAdminApplications(session.token),
      ]);
      setApplications(applicationValue.applications || []);
      setSummary(summaryValue);
      setMessage(`Application ${applicationId} marked ${status.toLowerCase()}.`);
    } catch (failure) { setError(failure.message); }
  }

  async function reviewLoan(applicationId, status) {
    setError(''); setMessage('');
    try {
      await reviewAdminLoanApplication(session.token, applicationId, status);
      setLoanApplications((await getAdminLoanApplications(session.token)).applications || []);
      setMessage(`Loan application ${applicationId} marked ${status.toLowerCase()}.`);
    } catch (failure) { setError(failure.message); }
  }

  async function viewKyc(application) {
    setError(''); setKycBusy(application.id);
    try {
      const blob = await downloadCustomerDocument(session.token, application.document.objectName);
      setKycUrl(current => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(blob); });
    } catch (failure) { setError(failure.message); }
    finally { setKycBusy(''); }
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">DHOLAKPUR BANK</span><h1>Bank administration</h1></div></div>
    {error && <div className="alert error global-error">{error}</div>}
    {message && <div className="alert success global-error">{message}</div>}
    <div className="metric-grid">
      <article><span>Customers</span><strong>{summary?.customers ?? '—'}</strong><small>Live customer count</small></article>
      <article><span>Total deposits</span><strong>{summary?.depositsMinor != null ? money(summary.depositsMinor) : '—'}</strong><small>Posted balances</small></article>
      <article><span>Pending applications</span><strong>{applications.length}</strong><small>Account approvals</small></article>
    </div>
    <section className="panel admin-table">
      <header><div><h2>Customer account applications</h2><p>Approval actions must be completed by the trusted admin service</p></div></header>
      {applications.length ? <div className="account-list">{applications.map(application => <div key={application.id}>
        <span className="account-icon"><UserRound size={18} /></span>
        <div><strong>{application.name || application.email}</strong><small>{application.id}</small></div>
        <div className="admin-actions">
          <button className="link-button" disabled={kycBusy === application.id} onClick={() => viewKyc(application)}>{kycBusy === application.id ? 'Loading KYC…' : 'View KYC'}</button>
          <button className="primary" onClick={() => review(application.id, 'APPROVED')}>Approve</button>
          <button className="link-button" onClick={() => review(application.id, 'HOLD')}>Hold</button>
          <button className="link-button" onClick={() => review(application.id, 'REJECTED')}>Reject</button>
        </div>
      </div>)}</div> : <div className="empty-state"><ShieldCheck size={28} /><strong>No pending or held applications</strong><p>New Firebase KYC applications will appear here.</p></div>}
    </section>
    <section className="panel admin-table" style={{ marginTop: 16 }}>
      <header><div><h2>Loan applications</h2><p>Application decisions do not disburse funds</p></div></header>
      {loanApplications.length ? <div className="account-list">{loanApplications.map(application => <div key={application.applicationId}>
        <span className="account-icon"><BadgeIndianRupee size={18} /></span>
        <div><strong>{application.loanType} · {application.email || application.ownerUid}</strong><small>{money(application.amountMinor)} · {application.tenureMonths} months · {application.applicationId}</small></div>
        <div className="admin-actions">
          <button className="primary" onClick={() => reviewLoan(application.applicationId, 'APPROVED')}>Approve</button>
          <button className="link-button" onClick={() => reviewLoan(application.applicationId, 'HOLD')}>Hold</button>
          <button className="link-button" onClick={() => reviewLoan(application.applicationId, 'REJECTED')}>Reject</button>
        </div>
      </div>)}</div> : <div className="empty-state"><BadgeIndianRupee size={24} /><strong>No loan applications</strong></div>}
    </section>
    {kycUrl && <section className="panel kyc-preview"><header><div><h2>KYC document</h2><p>Private document from your Firebase Storage</p></div><button className="link-button" onClick={() => { URL.revokeObjectURL(kycUrl); setKycUrl(''); }}>Close</button></header>
      <iframe title="Customer KYC document" src={kycUrl} />
    </section>}
    <section className="panel admin-table" style={{ marginTop: 16 }}>
      <header><div><h2>Transfer limit</h2><p>Trusted backend configuration</p></div></header>
      <form className="admin-form" onSubmit={async event => {
        event.preventDefault(); setError(''); setMessage('');
        const rupees = Number(limitRupees);
        if (!customerId.trim() || !Number.isFinite(rupees) || rupees < 0) {
          setError('Enter a customer ID and a valid limit.');
          return;
        }
        try {
          await saveTransferLimit(session.token, customerId.trim(), Math.round(rupees * 100));
          setMessage('Transfer limit updated by the trusted admin service.');
        } catch (failure) { setError(failure.message); }
      }}>
        <label>Customer ID<input value={customerId} onChange={e => setCustomerId(e.target.value)} required /></label>
        <label>Daily limit (INR)<input type="number" min="0" step="0.01" value={limitRupees} onChange={e => setLimitRupees(e.target.value)} required /></label>
        <button className="primary">Save limit</button>
      </form>
    </section>
    <section className="panel admin-table" style={{ marginTop: 16 }}>
      <header><div><h2>Offer campaigns</h2><p>Campaigns are stored in this bank’s Firestore</p></div></header>
      <form className="campaign-form" onSubmit={async event => {
        event.preventDefault(); setError(''); setMessage('');
        try {
          await createAdminCampaign(session.token, {
            ...campaign,
            startsAt: new Date(campaign.startsAt).toISOString(),
            expiresAt: new Date(campaign.expiresAt).toISOString(),
          });
          setCampaigns((await getAdminCampaigns(session.token)).campaigns || []);
          setCampaign({ title: '', description: '', code: '', discountLabel: '', startsAt: '', expiresAt: '', status: 'DRAFT' });
          setMessage('Offer campaign saved to Firebase.');
        } catch (failure) { setError(failure.message); }
      }}>
        <label>Offer title<input value={campaign.title} onChange={e => setCampaign({ ...campaign, title: e.target.value })} required /></label>
        <label>Coupon code<input value={campaign.code} onChange={e => setCampaign({ ...campaign, code: e.target.value.toUpperCase() })} required /></label>
        <label>Description<input value={campaign.description} onChange={e => setCampaign({ ...campaign, description: e.target.value })} required /></label>
        <label>Discount label<input value={campaign.discountLabel} onChange={e => setCampaign({ ...campaign, discountLabel: e.target.value })} required /></label>
        <label>Starts<input type="date" value={campaign.startsAt} onChange={e => setCampaign({ ...campaign, startsAt: e.target.value })} required /></label>
        <label>Expires<input type="date" value={campaign.expiresAt} onChange={e => setCampaign({ ...campaign, expiresAt: e.target.value })} required /></label>
        <label>Status<select value={campaign.status} onChange={e => setCampaign({ ...campaign, status: e.target.value })}><option>DRAFT</option><option>ACTIVE</option></select></label>
        <button className="primary">Save campaign</button>
      </form>
      {campaigns.map(item => <div className="campaign-row" key={item.id}><strong>{item.title}</strong><span>{item.code}</span><span>{item.status}</span></div>)}
    </section>
  </>;
}

export default function LiveBank({ bank, switchUrl, openDemo }) {
  const base = configuredEndpoint;
  const [session, setSession] = useState(null);
  const [firebaseSession, setFirebaseSession] = useState(null);
  const [page, setPage] = useState('home');
  const [data, setData] = useState({ accounts: [], transfers: [] });
  const [directory, setDirectory] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const activeToken = useRef(null);
  activeToken.current = session?.token;

  const refresh = useCallback(async signal => {
    if (!session || session.role === 'ADMIN') return;
    try {
      const value = await getCustomerDashboard(session.token);
      if (!signal?.aborted && activeToken.current === session.token) {
        setData(current => ({ ...current, ...value }));
        setError('');
      }
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message);
    }
  }, [session]);

  useEffect(() => {
    if (!session || session.role === 'ADMIN') return undefined;
    const controller = new AbortController();
    refresh(controller.signal);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(controller.signal); }, 12000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [session, refresh]);

  async function firebaseSignInAccount(account) {
    const { attributes } = await firebaseGetAccountClaims(account.idToken);
    if (attributes.role === 'ADMIN' || attributes.bankRole === 'BANK_ADMIN' || attributes.admin === true) {
      throw new Error('This is a bank administrator account. Use the Admin login tab.');
    }
    let application;
    try { application = await getCustomerApplication(account.idToken, account.localId); }
    catch (failure) {
      if (failure.message.includes('No customer application is saved')) {
        throw new Error('No Dholakpur Bank KYC application was found for this login.');
      }
      throw failure;
    }
    if (application.status !== 'APPROVED') {
      throw new Error(application.status === 'HOLD'
        ? 'Your KYC application is on hold. Contact Dholakpur Bank for next steps.'
        : application.status === 'REJECTED'
          ? 'Your KYC application was rejected. Contact Dholakpur Bank for help.'
          : 'Your KYC application is pending review. You can sign in after a bank administrator approves it.');
    }
    setFirebaseSession(account);
    setData(current => ({ ...current, application }));
    setSession({ token: account.idToken, uid: account.localId, email: account.email, role: 'CUSTOMER' });
  }

  async function persistCustomerApplication(account, { email, name, phone, address, documentFile }) {
    try {
      const existing = await getCustomerApplication(account.idToken, account.localId);
      if (existing.status === 'PENDING' || existing.status === 'HOLD' || existing.status === 'APPROVED') return;
    } catch (failure) {
      if (!failure.message.includes('No customer application is saved')) throw failure;
    }
    const document = await uploadCustomerDocument({ idToken: account.idToken, uid: account.localId, file: documentFile });
    await createCustomerApplication({
      idToken: account.idToken,
      uid: account.localId,
      profile: { name, email, phone, address },
      document,
    });
  }

  async function firebaseRegisterCustomer(form) {
    const { email, password } = form;
    const account = await firebaseRegister({ email, password });
    try {
      await persistCustomerApplication(account, form);
    } catch (failure) {
      return { resume: true, message: `Your Firebase login was created, but KYC submission did not finish: ${failure.message} Use the Register tab to complete the application after fixing the issue.` };
    }
  }

  async function firebaseResumeApplication(form) {
    const account = await firebaseSignIn({ email: form.email, password: form.password });
    await persistCustomerApplication(account, form);
  }

  async function firebaseAdminSignInAccount(email, password) {
    const account = await firebaseSignIn({ email, password });
    const { attributes } = await firebaseGetAccountClaims(account.idToken);
    const role = String(attributes.bankRole || attributes.role || '').toUpperCase();
    if (role !== 'BANK_ADMIN' && role !== 'ADMIN') {
      throw new Error('Admin access denied: this Firebase ID token has no bankRole=BANK_ADMIN claim. Set the claim with functions/scripts/set-bank-admin.js, then sign out and use the Bank Admin tab.');
    }
    setFirebaseSession(account);
    setSession({ token: account.idToken, uid: account.localId, email: account.email, role: 'ADMIN' });
    setPage('admin');
  }

  function logout() {
    setSession(null); setFirebaseSession(null); setData({ accounts: [], transfers: [], application: null }); setDirectory([]); setError(''); setPage('home');
  }

  if (!session) return <AuthScreen onCustomerSignIn={async (email, password) =>
    firebaseSignInAccount(await firebaseSignIn({ email, password }))}
    onCustomerRegister={firebaseRegisterCustomer} onCustomerResumeApplication={firebaseResumeApplication}
    onFirebaseAdminSignIn={firebaseAdminSignInAccount} />;

  return <div className="app-shell">
    <Sidebar page={page} setPage={setPage} logout={logout} bank={bank} role={session.role} />
    <main className="main-content">
      <header className="topbar"><button onClick={() => setPage('home')}><Home size={17} /> Dholakpur / <strong>{session.role === 'ADMIN' ? 'Bank admin' : 'My bank'}</strong></button>
        <div><span className="connection"><i /> Bank services {error ? 'unavailable' : 'ready'}</span>
          {session.role !== 'ADMIN' && <button className="icon-button" onClick={() => refresh()}><RefreshCw size={18} /></button>}</div>
      </header>
      <div className="content">
        {error && <div className="alert error global-error">{error}</div>}
        {notice && <div className="alert success global-error">{notice}<button onClick={() => setNotice('')}>×</button></div>}
        {page === 'home' && <Dashboard data={data} setPage={setPage} />}
        {page === 'transfer' && <TransferPage bank={bank} accounts={data.accounts || []} directory={directory}
          setDirectory={setDirectory} session={session} base={base} refresh={() => refresh()} setNotice={setNotice} />}
        {page === 'cards' && <CardsPage accounts={data.accounts || []} cards={data.cards || []}
          session={session} refresh={() => refresh()} />}
        {['loans', 'offers'].includes(page) && <CalculatorPage page={page} data={data}
          session={session} refresh={() => refresh()} />}
        {page === 'profile' && <ProfilePage session={session} onPasswordChange={password =>
          firebaseSession?.idToken ? firebaseUpdatePassword(firebaseSession.idToken, password)
            : Promise.reject(new Error('Password change requires an active Firebase REST session.'))} />}
        {page === 'admin' && session.role === 'ADMIN' && <AdminPage session={session} />}
      </div>
    </main>
  </div>;
}
