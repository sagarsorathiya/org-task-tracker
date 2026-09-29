# Deployment Guide (Windows + Linux)

This guide covers production deployment for Organization Activity Tracker on both Windows and Linux, including secure Domain SSO configuration for the feature-flagged SSO flow implemented in the app.

## 1. Deployment Model

- App runtime: Node.js server (`node server.js`)
- Reverse proxy: IIS (Windows) or Apache/Nginx (Linux)
- Database: PostgreSQL
- Default app port: `4000`
- SSO mode: header-based trusted proxy SSO (feature-flagged)

## 2. Prerequisites

- Node.js 20 LTS
- npm 10+
- PostgreSQL 15+
- SSL certificate for HTTPS endpoint
- Service account for running app process (non-admin)

## 3. Package And Copy

Create a deployment ZIP:

- Build the ZIP with `build-deploy.ps1` (Windows), or package the repository after `npm run build`

Copy ZIP to target server and extract to a fixed path, for example:

- Windows: `C:\apps\org-task-tracker`
- Linux: `/opt/org-task-tracker`

### 3.1 Single-Command Deployment Scripts

This repository includes two scripts for single-file ZIP deployment:

- Windows: `deploy-single-file.bat`
- Linux: `deploy-single-file.sh`

Usage:

```bat
deploy-single-file.bat [zipPath] [targetDir] [serviceName]
```

```bash
./deploy-single-file.sh [zipPath] [targetDir] [serviceName]
```

Defaults:

- ZIP: `./deploy/org-task-tracker-production.zip`
- Windows target: `C:\apps\org-task-tracker`
- Linux target: `/opt/org-task-tracker`
- Windows service: `OrgTaskTracker`
- Linux service: `org-task-tracker`

What scripts do:

1. Validate tools and input ZIP.
2. Extract ZIP to temp folder.
3. Stop service if it exists.
4. Create timestamp backup of current deployment.
5. Copy new files to target folder.
6. Run `npm ci` and `npm run build`.
7. Start/restart service (or run foreground if service is missing).

## 4. Environment Configuration

1. Copy `.env.example` to `.env.local`.
2. Set production values.
3. Ensure these core values are correct:

```env
PORT=4000
NEXTAUTH_URL=https://your-app-hostname
NEXTAUTH_SECRET=<min-32-char-secret>
NODE_ENV=production

PG_HOST=<postgres-host>
PG_PORT=5432
PG_DATABASE=organization_tracker
PG_USER=<db-user>
PG_PASSWORD=<db-password>

AUTH_TRUST_HOST=true
CORS_ORIGINS=https://your-app-hostname
```

### 4.1 PostgreSQL: Create Database And User

If PostgreSQL is installed but DB is empty, create the database and app user before first app start.

Login to PostgreSQL as superuser:

```bash
psql -U postgres
```

Run:

```sql
CREATE DATABASE organization_tracker;
CREATE USER organization_app WITH PASSWORD 'your_strong_password';
GRANT ALL PRIVILEGES ON DATABASE organization_tracker TO organization_app;
\c organization_tracker
GRANT USAGE, CREATE ON SCHEMA public TO organization_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO organization_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO organization_app;
```

Then set in `.env.local`:

```env
PG_DATABASE=organization_tracker
PG_USER=organization_app
PG_PASSWORD=your_strong_password
```

### 4.2 Run App Migration Explicitly

From the app folder:

```bash
npm ci
npm run migrate
```

Notes:

- `npm start` also attempts schema migration at startup.
- Running `npm run migrate` once manually is recommended for first-time production setup to validate DB access clearly.

## 5. Build And Run (Common)

From app folder:

```bash
npm ci
npm run build
npm start
```

Health check:

- `http://127.0.0.1:4000/login`

## 6. Windows Production Setup (IIS + Reverse Proxy)

### 6.1 Install IIS Components

Install these IIS features:

- Web Server (IIS)
- URL Rewrite Module
- Application Request Routing (ARR)
- Windows Authentication

Enable proxy in ARR settings.

### 6.2 Run Node App As Service

Use a process manager/service wrapper (for example NSSM):

- Service name: `OrgTaskTracker`
- Startup command: `node server.js`
- Working directory: `C:\apps\org-task-tracker`
- Startup type: Automatic

### 6.3 Configure IIS Site

1. Create HTTPS binding for your domain.
2. Configure reverse proxy to `http://127.0.0.1:4000`.
3. Preserve host header.

### 6.4 IIS SSO Configuration (Kerberos/NTLM)

IIS URL Rewrite expands `{LOGON_USER}` before Windows authentication runs, so a
proxied identity header is always empty. Domain identity therefore reaches the
app through a small ASP.NET bridge (`deploy/iis/_authbridge/negotiate.aspx`):

1. The login page calls `GET /api/sso/negotiate`. A rewrite rule maps it to `_authbridge/negotiate.aspx`, a location with Anonymous Authentication disabled and Windows Authentication enabled.
2. The bridge reads `User.Identity.Name` and calls `GET /api/sso/ticket` on the app over loopback with an `X-Sso-Bridge-Secret` header.
3. The app returns a short-lived (120 s) HMAC-signed ticket, which the login page submits to sign in.

Setup:

- Copy `_authbridge/negotiate.aspx` into the IIS site root and replace `__SSO_BRIDGE_SHARED_SECRET__` with the value of `SSO_BRIDGE_SHARED_SECRET`.
- Enable Windows Authentication and disable Anonymous Authentication **only** for the `_authbridge` location (usually in `applicationHost.config`, since the section is not delegated). Do not list `<providers>` explicitly; inherit them.
- Keep Anonymous Authentication enabled everywhere else so password logins are never challenged.
- Add rewrite rules in order: block external access to `^api/sso/ticket$` (403), map `^api/sso/negotiate$` to `_authbridge/negotiate.aspx`, then the catch-all reverse proxy.
- The app pool serving the bridge needs a managed runtime (v4.0); do not set it to "No Managed Code".
- A domain-joined browser and server, with a correct SPN, are required for Kerberos.

`SSO_BRIDGE_SHARED_SECRET` must differ from `SSO_PROXY_SHARED_SECRET`, because IIS may inject the latter onto every proxied request.

### 6.5 Windows .env SSO Values

```env
SSO_ENABLED=true
SSO_AUTO_LOGIN=true
SSO_IDENTITY_HEADER=x-forwarded-user
SSO_ALLOWED_DOMAINS=yourdomain
SSO_PROXY_SECRET_HEADER=x-sso-proxy-secret
SSO_PROXY_SHARED_SECRET=<long-random-secret>
SSO_BRIDGE_SHARED_SECRET=<different-long-random-secret>
```

## 7. Linux Production Setup

You can deploy with either Nginx only (no domain auto-login) or Apache with Kerberos module (domain auto-login).

### 7.1 Create Service User And Install

```bash
sudo mkdir -p /opt/org-task-tracker
sudo chown -R appuser:appuser /opt/org-task-tracker
cd /opt/org-task-tracker
npm ci
npm run build
```

### 7.2 systemd Service

Create `/etc/systemd/system/org-task-tracker.service`:

```ini
[Unit]
Description=Org Task Tracker
After=network.target

[Service]
Type=simple
User=appuser
WorkingDirectory=/opt/org-task-tracker
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable org-task-tracker
sudo systemctl start org-task-tracker
sudo systemctl status org-task-tracker
```

### 7.3 Reverse Proxy (Nginx)

Use Nginx for TLS termination and proxying:

```nginx
server {
    listen 443 ssl;
    server_name your-app-hostname;

    ssl_certificate /etc/ssl/certs/fullchain.pem;
    ssl_certificate_key /etc/ssl/private/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 7.4 Linux Domain SSO (Apache + mod_auth_gssapi)

If you need domain auto-login on Linux, use Apache in front with Kerberos/GSSAPI.

1. Install Apache and GSSAPI module (package names vary by distro).
2. Configure keytab and SPN for HTTP service principal.
3. Protect route/site with GSSAPI auth.
4. Set trusted headers for app:
- `x-forwarded-user` from authenticated principal (normalized to `DOMAIN\\username` or `username@domain`)
- `x-sso-proxy-secret` static shared secret
5. Strip inbound client-supplied values and overwrite at proxy.

App SSO env values remain the same as Windows section.

## 8. SSO Rollout Strategy (Safe)

1. Start with SSO disabled:

```env
SSO_ENABLED=false
SSO_AUTO_LOGIN=false
```

2. Configure proxy headers and shared secret.
3. Enable SSO button only:

```env
SSO_ENABLED=true
SSO_AUTO_LOGIN=false
```

4. Pilot with selected users.
5. Enable auto-login after validation:

```env
SSO_AUTO_LOGIN=true
```

## 9. Security Checklist

- Use HTTPS only.
- Never trust SSO headers from direct client traffic.
- Configure proxy to remove and then set SSO headers.
- Set strong `SSO_PROXY_SHARED_SECRET`.
- Restrict by `SSO_ALLOWED_DOMAINS`.
- Keep fallback LDAP/local login enabled during rollout.
- Monitor audit logs for:
  - `login_success_sso`
  - `login_failed_sso_untrusted_proxy`
  - `login_failed_sso_identity_missing`
  - `login_failed_sso_domain_disallowed`

## 10. Verification Steps

1. Verify service is running on `127.0.0.1:4000`.
2. Verify HTTPS public endpoint works.
3. Test standard LDAP login.
4. Test SSO button flow.
5. If `SSO_AUTO_LOGIN=true`, open `/login` from domain-joined machine and confirm silent login.
6. Check audit logs in Config page for SSO events and metadata.

## 11. Troubleshooting

- `Untrusted SSO request`:
  - Proxy secret mismatch or missing header.

- `SSO identity header missing`:
  - Proxy not forwarding user principal header.

- `Domain is not allowed for SSO`:
  - Update `SSO_ALLOWED_DOMAINS`.

- Redirect/login loop:
  - Verify `NEXTAUTH_URL`, proxy host headers, and HTTPS consistency.

- SSO works in browser A but not B:
  - Check browser intranet/negotiation settings and Kerberos policy.
