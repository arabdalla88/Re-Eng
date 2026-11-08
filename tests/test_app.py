import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import create_app, get_db


class ReEngApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.app = create_app(
            {
                "TESTING": True,
                "SECRET_KEY": "test-secret",
                "ADMIN_PASSWORD": "test-password",
                "DATABASE": str(root / "test.sqlite3"),
                "UPLOAD_FOLDER": str(root / "uploads"),
            }
        )
        self.client = self.app.test_client()
        self.csrf = self.client.get("/api/csrf").json["csrfToken"]

    def tearDown(self):
        self.temp.cleanup()

    def headers(self):
        return {"X-CSRF-Token": self.csrf}

    def submit_tool(self):
        return self.client.post(
            "/api/submissions",
            headers=self.headers(),
            data={
                "name": "Bench multimeter",
                "category": "Electronics",
                "condition": "Good",
                "description": "A reliable meter, tested recently.",
                "contact_name": "Sam Maker",
                "email": "sam@example.test",
                "phone": "+1 555 0100",
                "location": "Boston",
            },
        )

    def test_submission_starts_pending_and_is_not_public(self):
        response = self.submit_tool()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["status"], "Pending Inspection")
        self.assertEqual(self.client.get("/api/listings").json["listings"], [])
        self.assertEqual(self.client.get("/api/admin/submissions").status_code, 401)

    def test_admin_can_inspect_and_publish_listing(self):
        submission_id = self.submit_tool().json["id"]
        login = self.client.post(
            "/api/admin/login",
            headers=self.headers(),
            json={"password": "test-password"},
        )
        self.assertEqual(login.status_code, 200)
        self.csrf = login.json["csrfToken"]
        self.assertEqual(self.client.get("/api/admin/submissions").json["counts"]["pending"], 1)

        response = self.client.patch(
            f"/api/admin/submissions/{submission_id}",
            headers=self.headers(),
            json={
                "status": "listed",
                "grade": "B",
                "listing_type": "Sale",
                "asking_price": 45,
            },
        )
        self.assertEqual(response.status_code, 200)
        listings = self.client.get("/api/listings?category=Electronics&type=Sale").json["listings"]
        self.assertEqual(len(listings), 1)
        self.assertEqual(listings[0]["grade"], "B")
        self.assertNotIn("email", listings[0])

    def test_listing_cannot_skip_inspection_details(self):
        submission_id = self.submit_tool().json["id"]
        login = self.client.post(
            "/api/admin/login",
            headers=self.headers(),
            json={"password": "test-password"},
        )
        self.csrf = login.json["csrfToken"]
        self.assertEqual(
            self.client.patch(
                f"/api/admin/submissions/{submission_id}",
                headers=self.headers(),
                json={"status": "listed"},
            ).status_code,
            400,
        )

    def test_submission_requires_csrf_token(self):
        response = self.client.post("/api/submissions", data={"name": "No token"})
        self.assertEqual(response.status_code, 403)

    def test_homepage_and_assets_are_served(self):
        homepage = self.client.get("/")
        self.assertIn(b"Good tools.", homepage.data)
        homepage.close()
        asset = self.client.get("/static/app.js")
        self.assertEqual(asset.status_code, 200)
        asset.close()

    def test_vercel_requires_a_persistent_database(self):
        with patch.dict("os.environ", {"VERCEL": "1"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "persistent PostgreSQL"):
                create_app(
                    {
                        "TESTING": True,
                        "SECRET_KEY": "test-secret",
                        "ADMIN_PASSWORD": "test-password",
                        "DATABASE_URL": "",
                        "DATABASE": str(Path(self.temp.name) / "vercel.sqlite3"),
                        "UPLOAD_FOLDER": str(Path(self.temp.name) / "uploads"),
                    }
                )

    def test_postgres_connection_translates_sql_parameters(self):
        class FakeConnection:
            def __init__(self):
                self.queries = []

            def execute(self, query, parameters=()):
                self.queries.append((query, parameters))
                return self

            def commit(self):
                pass

            def rollback(self):
                pass

            def close(self):
                pass

        fake_connection = FakeConnection()
        original_url = self.app.config["DATABASE_URL"]
        self.app.config["DATABASE_URL"] = "postgresql://test"
        try:
            with patch("app.psycopg.connect", return_value=fake_connection):
                with get_db(self.app) as db:
                    db.execute("SELECT id FROM submissions WHERE id = ?", (7,))
        finally:
            self.app.config["DATABASE_URL"] = original_url

        self.assertEqual(
            fake_connection.queries,
            [("SELECT id FROM submissions WHERE id = %s", (7,))],
        )


if __name__ == "__main__":
    unittest.main()
