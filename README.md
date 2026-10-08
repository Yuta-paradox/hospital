# Emergency Bed Coordination (Next.js + MongoDB, Vercel-ready)

| Page | URL | For |
|---|---|---|
| Patient / family | `/patient` | find and reserve a bed, track it |
| Hospital staff | `/admin` | register hospital, manage beds, respond to incoming patients |
| Control room | `/dispatch` | live capacity, active referrals (needs `PLATFORM_KEY`) |
| Verifier | `/platform` | verify hospital registrations (needs `PLATFORM_KEY`) |
| Health check | `/api/health` | shows whether MongoDB connects and which routing API is active |

## Deploy (GitHub -> Vercel)
1. **MongoDB**: create a free Atlas M0 cluster (Mumbai `ap-south-1`). Create a database user. Network Access -> allow `0.0.0.0/0` (Vercel has no fixed IPs). Connect -> Drivers -> copy the connection string.
2. Push this folder to GitHub, import the repo in Vercel.
3. Vercel -> Settings -> Environment Variables:

| Variable | Required | Value |
|---|---|---|
| `MONGODB_URI` | yes | Atlas connection string |
| `MONGODB_DB` | no | database name (default `bedagent`) |
| `AUTH_SECRET` | yes | `openssl rand -hex 32` |
| `PLATFORM_KEY` | yes | any long secret (unlocks `/platform`, `/dispatch`) |
| `RESEND_API_KEY`, `MAIL_FROM` | yes (production) | email provider for the verification code (free at resend.com). Without it, registration is refused in production |
| `ALLOW_FREE_EMAIL` | no | `1` allows Gmail/Yahoo addresses (testing only) |
| `GOOGLE_MAPS_API_KEY` | no | live-traffic ETAs (Routes API). Empty = free OSRM |
| `OSRM_URL` | no | your own OSRM server. Empty = public demo server |
| `APP_CONTACT` | no | your email, sent to OpenStreetMap geocoding as required by their policy |

4. Deploy, open `/api/health`, it must show `{"ok":true,"db":true}`. Collections and indexes are created automatically on first use.
5. Local: copy `.env.example` to `.env.local`, fill it, `npm install && npm run dev`. Optional demo data: `npm run db:seed` (logins `admin.a@demo.test` / `staff.a@demo.test`, password `Demo@12345`). Never seed production.

## Only real hospitals (registration and login)
1. **Registration needs proof fields:** registration/licence number, licence valid-until date, official website, medical-council number of the in-charge doctor, 24x7 emergency phone, GPS location. Free email domains (Gmail, Yahoo, Outlook…) are refused; duplicate registration number, phone or email are refused.
2. **Email code (OTP):** 6 digits, 15 minutes, 5 tries. No sign-in until the email is verified, for admins and staff alike. Staff added by an admin verify at first sign-in. Admins can add staff only after their hospital is verified.
3. **Automatic flags for the verifier:** email domain vs website domain, another hospital within 100 m, expired licence.
4. **Human verification (`/platform`):** the Verify button stays disabled until all four checks are ticked (official register, phone call-back, location, email domain) and the verifier enters their name. The decision, verifier and time are stored on the hospital and in the audit log. Rejecting needs a reason.
5. **Patients see only verified hospitals with a valid licence.**
6. Passwords: 10+ characters with upper, lower and digit; 5 wrong logins lock the account for 15 minutes; per-IP rate limits.
7. Control room shows live numbers from MongoDB: capacity, active referrals, every hospital with its emergency number and how stale its counts are, and the last 30 referrals (patient shown as initials and last 4 digits).

## Critical-patient confirmation flow
- A **critical** reservation gives the hospital **3 minutes** to respond (stable: 10). Confirming opens a 30-minute arrival window.
- **Hospital screen:** red banner, live countdown per patient, alarm repeats every 6 s until someone confirms or declines.
- **Late confirm is blocked:** confirm only works while the window is open, so a late click can never take back a bed already given to someone else. Staff get a clear message instead.
- **Patient screen:** live countdown, "call the hospital now" warning, and on decline / no response the **next best hospital is reserved automatically after 10 s** (cancellable). Stable cases choose manually.
- **Control room:** a critical referral with no response for 60 s is flagged "no response - phone the hospital".

## Two patients, one bed
- Bed claim is a single atomic MongoDB update, so two patients can never be given the same bed.
- The loser gets "bed was just taken by another patient" and the next best hospitals are shown at once (excluding hospitals already tried).
- Max 2 active holds per phone number; rate limits on search, reserve, login, register, geocode.
- Expired holds are released automatically on every read (serverless has no timers).

## Still needed before real-world use
Phone OTP for patients, email verification / password reset for staff, privacy and legal review (patient name, phone, condition are stored), clinical validation of ranking weights, automated tests, uptime alerts.
