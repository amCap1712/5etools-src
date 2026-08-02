import os

_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _database_url():
	url = os.environ.get("DATABASE_URL", "")
	if not url:
		return f"sqlite:///{os.path.join(_SERVER_DIR, 'tavern.db')}"
	# Normalize the legacy scheme some providers (e.g. Heroku) still emit
	if url.startswith("postgres://"):
		url = url.replace("postgres://", "postgresql+psycopg2://", 1)
	return url


class Config:
	SECRET_KEY = os.environ.get("TAVERN_SECRET_KEY", "dev-secret-do-not-use-in-prod")
	SQLALCHEMY_DATABASE_URI = _database_url()
	SQLALCHEMY_TRACK_MODIFICATIONS = False
	GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID") or None
	JWT_EXPIRY_DAYS = int(os.environ.get("TAVERN_JWT_EXPIRY_DAYS", "30"))
	UPLOAD_DIR = os.environ.get("TAVERN_UPLOAD_DIR") or os.path.join(_SERVER_DIR, "uploads")
	MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5 MiB upload cap
	CORS_ORIGINS = os.environ.get("TAVERN_CORS_ORIGINS", "*")
