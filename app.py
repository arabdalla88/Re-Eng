import hmac
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import psycopg
import requests
from flask import Flask, abort, current_app, jsonify, request, send_from_directory, session
from psycopg.rows import dict_row
from werkzeug.exceptions import RequestEntityTooLarge


ROOT = Path(__file__).resolve().parent
ALLOWED_CATEGORIES = {"Electronics", "Mechanical", "Architecture"}
ALLOWED_CONDITIONS = {"Like new", "Good", "Fair", "For parts"}
ALLOWED_GRADES = {"A", "B", "C", "For parts"}
ALLOWED_STATUSES = {"pending", "inspection", "listed", "closed"}
ALLOWED_LISTING_TYPES = {"Sale", "Rent"}
MAX_PHOTOS = 3
MAX_PHOTO_BYTES = 4 * 1024 * 1024
MAX_TOTAL_PHOTO_BYTES = 4 * 1024 * 1024
IMAGE_SIGNATURES = {
    ".jpg": (("image/jpeg",), (b"\xff\xd8\xff",)),
    ".jpeg": (("image/jpeg",), (b"\xff\xd8\xff",)),
    ".png": (("image/png",), (b"\x89PNG\r\n\x1a\n",)),
    ".webp": (("image/webp",), (b"RIFF",)),
}


def create_app(test_config=None):
    app = Flask(__name__, static_folder=None)
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("REENG_SECRET_KEY"),
        ADMIN_PASSWORD=os.environ.get("REENG_ADMIN_PASSWORD"),
        DATABASE_URL=os.environ.get("DATABASE_URL"),
        SUPABASE_URL=os.environ.get("SUPABASE_URL", "").rstrip("/"),
        SUPABASE_SERVICE_ROLE_KEY=os.environ.get("SUPABASE_SERVICE_ROLE_KEY"),
        SUPABASE_STORAGE_BUCKET=os.environ.get("SUPABASE_STORAGE_BUCKET", "reeng-images"),
        DATABASE=os.environ.get("REENG_DATABASE", str(ROOT / "instance" / "reeng.sqlite3")),
        UPLOAD_FOLDER=os.environ.get("REENG_UPLOAD_FOLDER", str(ROOT / "instance" / "uploads")),
        MAX_CONTENT_LENGTH=4_500 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get(
            "REENG_COOKIE_SECURE", "true" if os.environ.get("VERCEL") else "false"
        ).lower() == "true",
    )
    if test_config:
        app.config.update(test_config)
    if not app.config["SECRET_KEY"]:
        raise RuntimeError("Set REENG_SECRET_KEY before starting Re-Eng.")
    if not app.config["ADMIN_PASSWORD"]:
        raise RuntimeError("Set REENG_ADMIN_PASSWORD before starting Re-Eng.")
    if os.environ.get("VERCEL") and not app.config["DATABASE_URL"]:
        raise RuntimeError("Set DATABASE_URL to a persistent PostgreSQL database before deploying to Vercel.")
    if app.config["DATABASE_URL"] and (
        not app.config["SUPABASE_URL"] or not app.config["SUPABASE_SERVICE_ROLE_KEY"]
    ):
        raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for hosted photo storage.")

    if not app.config["DATABASE_URL"]:
        Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
        Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
    initialize_database(app)

    @app.get("/")
    def home():
        return send_from_directory(ROOT / "public", "index.html")

    @app.get("/static/<path:filename>")
    def static_asset(filename):
        return send_from_directory(ROOT / "public" / "static", filename)

    @app.get("/api/csrf")
    def get_csrf_token():
        token = session.get("csrf_token")
        if not token:
            token = secrets.token_urlsafe(32)
            session["csrf_token"] = token
        return jsonify({"csrfToken": token})

    @app.get("/api/listings")
    def get_listings():
        category = request.args.get("category", "").strip()
        listing_type = request.args.get("type", "").strip()
        search = request.args.get("q", "").strip()
        if category and category not in ALLOWED_CATEGORIES:
            return jsonify({"error": "Choose a valid category."}), 400
        if listing_type and listing_type not in ALLOWED_LISTING_TYPES:
            return jsonify({"error": "Choose Sale or Rent."}), 400

        clauses = ["status = 'listed'", "grade IS NOT NULL", "asking_price IS NOT NULL"]
        params = []
        if category:
            clauses.append("category = ?")
            params.append(category)
        if listing_type:
            clauses.append("listing_type = ?")
            params.append(listing_type)
        if search:
            match_operator = "ILIKE" if app.config["DATABASE_URL"] else "LIKE"
            clauses.append(
                f"(name {match_operator} ? OR description {match_operator} ? "
                f"OR location {match_operator} ?)"
            )
            term = f"%{search[:100]}%"
            params.extend((term, term, term))

        with get_db(app) as db:
            rows = db.execute(
                f"SELECT id, name, category, condition, grade, description, listing_type, "
                f"asking_price, location, photos, created_at FROM submissions "
                f"WHERE {' AND '.join(clauses)} ORDER BY updated_at DESC",
                params,
            ).fetchall()
        return jsonify({"listings": [public_item(row) for row in rows]})

    @app.post("/api/submissions")
    def create_submission():
        csrf_error = verify_csrf()
        if csrf_error:
            return csrf_error

        form = request.form
        name = form.get("name", "").strip()
        category = form.get("category", "").strip()
        condition = form.get("condition", "").strip()
        description = form.get("description", "").strip()
        contact_name = form.get("contact_name", "").strip()
        email = form.get("email", "").strip()
        phone = form.get("phone", "").strip()
        location = form.get("location", "").strip()
        if not name or len(name) > 120:
            return jsonify({"error": "Tool name is required and must be under 120 characters."}), 400
        if category not in ALLOWED_CATEGORIES:
            return jsonify({"error": "Choose a valid category."}), 400
        if condition not in ALLOWED_CONDITIONS:
            return jsonify({"error": "Choose a condition."}), 400
        if not description or len(description) > 2000:
            return jsonify({"error": "Add a description of up to 2,000 characters."}), 400
        if not contact_name or len(contact_name) > 100:
            return jsonify({"error": "Your name is required."}), 400
        if (
            not email
            or len(email) > 254
            or email.count("@") != 1
            or not email.split("@")[0]
            or "." not in email.split("@")[1]
        ):
            return jsonify({"error": "Enter a valid email address."}), 400
        if len(phone) > 40 or not location or len(location) > 120:
            return jsonify({"error": "Enter a valid phone number and city or area."}), 400

        photos = request.files.getlist("photos")
        if len(photos) > MAX_PHOTOS:
            return jsonify({"error": f"Upload up to {MAX_PHOTOS} photos."}), 400

        photo_data = []
        total_photo_bytes = 0
        try:
            for photo in photos:
                if not photo or not photo.filename:
                    continue
                extension = Path(photo.filename).suffix.lower()
                signatures = IMAGE_SIGNATURES.get(extension)
                if not signatures or photo.mimetype not in signatures[0]:
                    return jsonify({"error": "Photos must be JPEG, PNG, or WebP images."}), 400
                content = photo.stream.read(MAX_PHOTO_BYTES + 1)
                if len(content) > MAX_PHOTO_BYTES:
                    return jsonify({"error": "Each photo must be 4 MB or smaller."}), 400
                total_photo_bytes += len(content)
                if total_photo_bytes > MAX_TOTAL_PHOTO_BYTES:
                    return jsonify({"error": "All photos together must total 4 MB or less."}), 400
                signature = signatures[1][0]
                if not content.startswith(signature):
                    return jsonify({"error": "An uploaded photo is not a valid image file."}), 400
                if extension == ".webp" and content[8:12] != b"WEBP":
                    return jsonify({"error": "An uploaded photo is not a valid WebP image."}), 400
                photo_data.append((extension, content))

            saved_files = []
            for extension, content in photo_data:
                filename = f"{secrets.token_hex(16)}{extension}"
                saved_files.append(filename)
                save_photo(app, filename, content)

            now = datetime.now(timezone.utc).isoformat()
            with get_db(app) as db:
                insert_sql = (
                    "INSERT INTO submissions "
                    "(name, category, condition, description, contact_name, email, phone, location, "
                    "photos, status, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)"
                )
                if app.config["DATABASE_URL"]:
                    insert_sql += " RETURNING id"
                cursor = db.execute(
                    insert_sql,
                    (
                        name,
                        category,
                        condition,
                        description,
                        contact_name,
                        email,
                        phone,
                        location,
                        ",".join(saved_files),
                        now,
                        now,
                    ),
                )
                submission_id = (
                    cursor.fetchone()["id"] if app.config["DATABASE_URL"] else cursor.lastrowid
                )
        except (sqlite3.Error, psycopg.Error, OSError, requests.RequestException):
            remove_photos(app, saved_files)
            app.logger.exception("Unable to save tool submission or uploaded photos")
            return jsonify({"error": "We could not save your submission. Please try again."}), 500

        return jsonify({"id": submission_id, "status": "Pending Inspection"}), 201

    @app.get("/api/admin/session")
    def admin_session():
        return jsonify({"authenticated": bool(session.get("is_admin"))})

    @app.post("/api/admin/login")
    def admin_login():
        csrf_error = verify_csrf()
        if csrf_error:
            return csrf_error
        password = request.json.get("password", "") if request.is_json else ""
        if not isinstance(password, str) or not hmac.compare_digest(
            password, app.config["ADMIN_PASSWORD"]
        ):
            return jsonify({"error": "That password doesn't match. Try again."}), 401
        session.clear()
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
        session["is_admin"] = True
        return jsonify({"authenticated": True, "csrfToken": token})

    @app.post("/api/admin/logout")
    def admin_logout():
        denied = require_admin()
        if denied:
            return denied
        csrf_error = verify_csrf()
        if csrf_error:
            return csrf_error
        session.clear()
        return jsonify({"authenticated": False})

    @app.get("/api/admin/submissions")
    def admin_submissions():
        denied = require_admin()
        if denied:
            return denied
        with get_db(app) as db:
            rows = db.execute(
                "SELECT * FROM submissions ORDER BY "
                "CASE status WHEN 'pending' THEN 0 WHEN 'inspection' THEN 1 "
                "WHEN 'listed' THEN 2 ELSE 3 END, created_at DESC"
            ).fetchall()
        return jsonify(
            {
                "submissions": [admin_item(row) for row in rows],
                "counts": {
                    status: sum(row["status"] == status for row in rows)
                    for status in ALLOWED_STATUSES
                },
            }
        )

    @app.patch("/api/admin/submissions/<int:submission_id>")
    def update_submission(submission_id):
        denied = require_admin()
        if denied:
            return denied
        csrf_error = verify_csrf()
        if csrf_error:
            return csrf_error
        payload = request.get_json(silent=True) or {}
        allowed_fields = {"status", "grade", "listing_type", "asking_price"}
        if not payload or set(payload) - allowed_fields:
            return jsonify({"error": "Only workflow status, grade, listing type, and price can be updated."}), 400
        if "status" in payload and payload["status"] not in ALLOWED_STATUSES:
            return jsonify({"error": "Choose a valid workflow stage."}), 400
        grade = payload.get("grade")
        if "grade" in payload and grade not in ALLOWED_GRADES:
            return jsonify({"error": "Choose a valid inspection grade."}), 400
        listing_type = payload.get("listing_type")
        if "listing_type" in payload and listing_type not in ALLOWED_LISTING_TYPES:
            return jsonify({"error": "Choose Sale or Rent."}), 400
        asking_price = payload.get("asking_price")
        if "asking_price" in payload:
            if isinstance(asking_price, bool) or not isinstance(asking_price, (float, int)):
                return jsonify({"error": "Enter a valid price."}), 400
            if asking_price <= 0 or asking_price > 1_000_000:
                return jsonify({"error": "Price must be between 0 and 1,000,000."}), 400

        fields = []
        values = []
        for field in allowed_fields & payload.keys():
            fields.append(f"{field} = ?")
            values.append(payload[field])
        values.append(datetime.now(timezone.utc).isoformat())
        values.append(submission_id)
        with get_db(app) as db:
            existing = db.execute(
                "SELECT status, grade, listing_type, asking_price FROM submissions WHERE id = ?",
                (submission_id,),
            ).fetchone()
            if not existing:
                return jsonify({"error": "Submission not found."}), 404
            next_status = payload.get("status", existing["status"])
            next_grade = payload.get("grade", existing["grade"])
            next_listing_type = payload.get("listing_type", existing["listing_type"])
            next_price = payload.get("asking_price", existing["asking_price"])
            if next_status == "listed" and (not next_grade or not next_listing_type or not next_price):
                return jsonify({"error": "Add an inspection grade, listing type, and price before listing."}), 400
            db.execute(
                f"UPDATE submissions SET {', '.join(fields)}, updated_at = ? WHERE id = ?",
                values,
            )
        return jsonify({"updated": True})

    @app.get("/uploads/<path:filename>")
    def uploaded_photo(filename):
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename, max_age=3600)

    @app.errorhandler(RequestEntityTooLarge)
    def request_too_large(_error):
        return jsonify({"error": "Your upload is too large. Keep all photos together under 4 MB."}), 413

    return app


def initialize_database(app):
    schema_file = "schema_postgres.sql" if app.config["DATABASE_URL"] else "schema.sql"
    schema = (ROOT / schema_file).read_text(encoding="utf-8")
    with get_db(app) as db:
        if app.config["DATABASE_URL"]:
            for statement in schema.split(";"):
                if statement.strip():
                    db.execute(statement)
        else:
            db.executescript(schema)


@contextmanager
def get_db(app):
    if app.config["DATABASE_URL"]:
        db = psycopg.connect(app.config["DATABASE_URL"], row_factory=dict_row)
        execute = db.execute
    else:
        db = sqlite3.connect(app.config["DATABASE"])
        db.row_factory = sqlite3.Row
        execute = db.execute

    if app.config["DATABASE_URL"]:
        class PostgresConnection:
            def execute(self, query, parameters=()):
                return execute(query.replace("?", "%s"), parameters)

            def commit(self):
                db.commit()

            def rollback(self):
                db.rollback()

            def close(self):
                db.close()

        connection = PostgresConnection()
    else:
        connection = db
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def save_photo(app, filename, content):
    if app.config["DATABASE_URL"]:
        response = requests.post(
            f"{app.config['SUPABASE_URL']}/storage/v1/object/"
            f"{quote(app.config['SUPABASE_STORAGE_BUCKET'], safe='')}/{quote(filename, safe='')}",
            headers={
                "Authorization": f"Bearer {app.config['SUPABASE_SERVICE_ROLE_KEY']}",
                "apikey": app.config["SUPABASE_SERVICE_ROLE_KEY"],
                "Content-Type": image_mimetype(Path(filename).suffix),
                "x-upsert": "false",
            },
            data=content,
            timeout=20,
        )
        response.raise_for_status()
    else:
        (Path(app.config["UPLOAD_FOLDER"]) / filename).write_bytes(content)


def remove_photos(app, filenames):
    if not filenames:
        return
    if app.config["DATABASE_URL"]:
        try:
            response = requests.delete(
                f"{app.config['SUPABASE_URL']}/storage/v1/object/"
                f"{quote(app.config['SUPABASE_STORAGE_BUCKET'], safe='')}",
                headers={
                    "Authorization": f"Bearer {app.config['SUPABASE_SERVICE_ROLE_KEY']}",
                    "apikey": app.config["SUPABASE_SERVICE_ROLE_KEY"],
                },
                json={"prefixes": filenames},
                timeout=20,
            )
            response.raise_for_status()
        except requests.RequestException:
            app.logger.exception("Unable to remove uploaded photos after a failed submission")
    else:
        for filename in filenames:
            (Path(app.config["UPLOAD_FOLDER"]) / filename).unlink(missing_ok=True)


def image_mimetype(extension):
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }[extension.lower()]


def verify_csrf():
    expected = session.get("csrf_token")
    supplied = request.headers.get("X-CSRF-Token", "")
    if not expected or not hmac.compare_digest(expected, supplied):
        return jsonify({"error": "Your session expired. Refresh the page and try again."}), 403
    return None


def require_admin():
    if not session.get("is_admin"):
        return jsonify({"error": "Admin sign-in required."}), 401
    return None


def photo_urls(row):
    photos = [name for name in row["photos"].split(",") if name]
    if current_app.config["DATABASE_URL"]:
        base_url = (
            f"{current_app.config['SUPABASE_URL']}/storage/v1/object/public/"
            f"{quote(current_app.config['SUPABASE_STORAGE_BUCKET'], safe='')}/"
        )
        return [f"{base_url}{quote(name, safe='')}" for name in photos]
    return [f"/uploads/{name}" for name in photos]


def public_item(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "category": row["category"],
        "condition": row["condition"],
        "grade": row["grade"],
        "description": row["description"],
        "listingType": row["listing_type"],
        "askingPrice": row["asking_price"],
        "location": row["location"],
        "photos": photo_urls(row),
    }


def admin_item(row):
    item = public_item(row)
    item.update(
        {
            "status": row["status"],
            "contactName": row["contact_name"],
            "email": row["email"],
            "phone": row["phone"],
            "createdAt": row["created_at"],
        }
    )
    return item


app = create_app() if __name__ == "__main__" or os.environ.get("VERCEL") else None

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)
