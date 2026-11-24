# Dholakpur Bank

A responsive React/Vite banking portal with a Dholakpur-inspired village theme.

## Run locally

```bash
npm ci
npm run dev
```

## Independent bank authentication and data

Customer registration, sign-in, password reset, and password change use this bank’s own Firebase Authentication project. Registration writes the customer application to this bank’s Firestore and uploads the submitted KYC document to this bank’s Firebase Storage. Customer login does not call the SharedBank/Central Bank service.

Set these environment variables (no service-account credentials belong in this frontend):

```text
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
```

Enable Email/Password in Firebase Authentication. Apply `firestore.rules` and `storage.rules` to this Firebase project. Customer applications begin in `PENDING`. On approval, the trusted backend posts a ₹1,000 sandbox opening credit to the customer account and records it in the ledger. This is simulated money, not a real deposit.

The app checks the Firestore application status after every customer sign-in. `PENDING`, `HOLD`, and `REJECTED` applications cannot enter the banking area or use customer API routes. Approval is the only transition that opens a bank account and permits sign-in.

## Bank admin login

The login screen has a separate **Admin** tab for this bank’s administrators. Admin access requires a server-issued Firebase custom claim:

- `bankRole: "BANK_ADMIN"` (recommended), or
- `role: "ADMIN"`

Set the claim using trusted Firebase Admin SDK tooling. The admin panel is for Dholakpur Bank; it is not a Central Bank account. UI role checks are not authorization: every admin endpoint must independently verify the Firebase ID token and bank-admin claim.

Adding `role: "ADMIN"` to a Firestore user document does **not** grant admin access. The role must be a Firebase Authentication custom claim. Then sign out and choose the **Bank Admin** tab on the login screen so Firebase issues a fresh ID token containing that claim.

The Firebase Functions API in `functions/` implements customer dashboards, atomic internal transfers with a double-entry ledger, KYC review/account opening, sandbox debit-card controls, loan applications and review, bank admin summaries, transfer limits, notifications, and offer-campaign configuration. It defaults to this Firebase project’s `us-central1` function URL; set `VITE_BANK_API_URL` only to override it. Deploy functions and rules to activate those operations:

```bash
cd functions
npm install
cd ..
npx --yes firebase-tools login
npx --yes firebase-tools deploy --project dholakpur-bank --only functions,firestore,storage
```

Cloud Functions deployment may require the Firebase project to be on the Blaze plan. The Firebase CLI must be authenticated as a project administrator. This environment is not currently logged in to Firebase, so deployment has not been run here.

Grant the first bank administrator a custom claim from Google Cloud Shell or a secured machine with Application Default Credentials:

```bash
cd functions
node scripts/set-bank-admin.js FIREBASE_AUTH_UID
```

On a local machine, authenticate Google Application Default Credentials first (`gcloud auth application-default login`) and select the `dholakpur-bank` project. Use the UID shown under Firebase Console → Authentication → Users; do not use the email or a Firestore document ID.

Approved accounts receive the ₹1,000 sandbox opening credit described above. It is visibly labeled as simulated in the customer dashboard, remains marked when moved through internal transfers, and cannot be sent through the inter-bank UI. It must not be used or represented as real funds. The Central Bank Worker must also validate funding independently before processing any inter-bank transfer.

## Inter-bank transfers only

The existing SharedBank/Cloudflare integration is used only after the customer explicitly selects **Other bank**:

- Worker origin: `src/cloudflare-config.js`
- Bank identity: `src/bank-config.js`
- Directory and transfer calls: `src/live-api.js`

Set `VITE_X42_API_URL` to override its origin. The integration must verify this bank’s Firebase ID token and resolve the customer’s Central Bank account from the verified UID. For the supplied synthetic P653 test record, the Worker should map the verified customer to its Central account server-side; do not hardcode a customer UID or account number in the frontend. If the Worker only accepts a separate Central Bank customer login, it does not meet the independent-login requirement and must be updated server-side. The frontend does not sign customers into that service.

The configured IFSC in `src/bank-config.js` is `DEWA0N7P2BX`, matching the Central Bank synthetic P653 account details supplied for this integration. Treat it as a sandbox routing value, not as evidence of an RBI-assigned IFSC. The directory endpoint returned HTTP 503 during setup; confirm with the Central Bank before using it for live settlement.

Internal transfers must use this bank’s own backend and ledger; they do not call the SharedBank worker. The browser never changes balances directly.

Debit cards are explicitly sandbox records and do not connect to card networks. Loan decisions are application decisions only; they do not set lending terms or disburse money. Campaigns can be configured and displayed, but coupon redemption, cashback settlement, email delivery, real card-network processing, and loan funding still require their respective trusted providers.
