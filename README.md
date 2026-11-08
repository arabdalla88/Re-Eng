# Re-Eng

Re-Eng is an intake and operations MVP for giving pre-owned engineering tools a second life. Owners can submit tools for review, the operations team can inspect and publish them, and buyers can browse the live catalog.

## What is included

- Responsive landing page, tool intake form, search/filter catalog, and admin workflow dashboard.
- Flask JSON API with SQLite for local development, PostgreSQL on Vercel, and private owner contact details.
- Admin session authentication, CSRF protection, and validated image uploads.
- Workflow stages: Pending Inspection → Physical Inspection & Grading → Listed for Sale/Rent → Sold / Rented Out.

## Run locally

Requirements: Python 3.10+ and pip.

```powershell
cd D:\Re-Eng
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

$env:REENG_SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
$env:REENG_ADMIN_PASSWORD = "choose-a-strong-password"
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000). Select **Admin** and sign in with `REENG_ADMIN_PASSWORD`.

The database and uploaded images are created under `instance/`. To use different locations, set `REENG_DATABASE` and `REENG_UPLOAD_FOLDER`. Never use the example secrets in production.

## Deploy to Vercel

Vercel's function filesystem is temporary, so production uses Supabase PostgreSQL for submissions and a Supabase Storage bucket for photos. Vercel detects the Flask application exported from `index.py`; assets in `public/` are served from Vercel's CDN. It is not safe to deploy with the local SQLite database.

1. Create a Supabase project. In **SQL Editor**, run the contents of `schema_postgres.sql`.
2. In **Storage**, create a public bucket named `reeng-images` (or choose another name and set `SUPABASE_STORAGE_BUCKET`).
3. In the Supabase project settings, copy the PostgreSQL connection URI and project URL. Create a `service_role` secret key; never put it in frontend code or commit it.
4. Push this project to a GitHub repository and import it in Vercel.
5. In **Vercel → Project → Settings → Environment Variables**, set these for Production (and Preview if needed):

   | Name | Value |
   |---|---|
   | `REENG_SECRET_KEY` | A new, long random secret |
   | `REENG_ADMIN_PASSWORD` | A new, strong admin password |
   | `DATABASE_URL` | Supabase PostgreSQL URI |
   | `SUPABASE_URL` | Supabase project URL, e.g. `https://your-project.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role secret |
   | `SUPABASE_STORAGE_BUCKET` | `reeng-images` |

6. Redeploy after setting the variables. Open the Vercel deployment URL and test an owner submission, admin sign-in, and image upload.

Do not set `REENG_DATABASE` or `REENG_UPLOAD_FOLDER` on Vercel. The app deliberately refuses to start there without `DATABASE_URL`, so data is not silently written to temporary storage.

Existing SQLite records and locally uploaded photos are not copied automatically to Supabase. Back them up and migrate them separately before switching production traffic if they need to be retained.

### Deploy from the command line

Alternatively, install the Vercel CLI and run `vercel` from the project directory. Add the same environment variables in the Vercel project settings before promoting a production deployment. Do not paste database credentials into source files or commit them.

## Run tests

```powershell
python -m unittest discover -s tests -v
```

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/csrf` | Start a session and issue a CSRF token |
| `POST` | `/api/submissions` | Submit a tool (`multipart/form-data`) |
| `GET` | `/api/listings` | Browse listed tools; optional `q`, `category`, and `type` filters |
| `GET` | `/api/admin/session` | Check admin sign-in state |
| `POST` | `/api/admin/login` | Sign in with the configured admin password |
| `GET` | `/api/admin/submissions` | Review all submissions and workflow counts |
| `PATCH` | `/api/admin/submissions/<id>` | Update status, inspection grade, listing type, and price |
| `POST` | `/api/admin/logout` | End the admin session |

Every mutating request requires the session's `X-CSRF-Token`. Photos are optional; up to three JPEG, PNG, or WebP images are accepted, with a combined upload limit of 4 MB for serverless compatibility.
