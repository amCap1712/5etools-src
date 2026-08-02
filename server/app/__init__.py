import os

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, jsonify, send_from_directory  # noqa: E402
from flask_cors import CORS  # noqa: E402
from werkzeug.exceptions import HTTPException  # noqa: E402

from .config import Config  # noqa: E402
from .extensions import db  # noqa: E402


def create_app(config_object=None):
	app = Flask(__name__)
	app.config.from_object(config_object or Config)

	os.makedirs(app.config["UPLOAD_DIR"], exist_ok=True)

	db.init_app(app)

	origins = app.config["CORS_ORIGINS"]
	if origins != "*":
		origins = [o.strip() for o in origins.split(",") if o.strip()]
	CORS(app, resources={r"/api/*": {"origins": origins}})

	from . import models_srd  # noqa: F401 -- register SRD tables with create_all
	from .routes import adventures, auth, characters, profile, srd

	app.register_blueprint(auth.bp, url_prefix="/api/auth")
	app.register_blueprint(profile.bp, url_prefix="/api")
	app.register_blueprint(characters.bp, url_prefix="/api")
	app.register_blueprint(adventures.bp, url_prefix="/api")
	app.register_blueprint(srd.bp, url_prefix="/api")

	@app.get("/api/health")
	def health():
		return jsonify({"ok": True})

	@app.get("/api/uploads/<path:filename>")
	def uploaded_file(filename):
		return send_from_directory(app.config["UPLOAD_DIR"], filename, max_age=86400)

	@app.errorhandler(HTTPException)
	def handle_http_exception(e):
		return jsonify({"error": e.description}), e.code

	@app.errorhandler(Exception)
	def handle_exception(e):
		app.logger.exception("Unhandled error")
		return jsonify({"error": "Internal server error"}), 500

	with app.app_context():
		# Phase 1: create tables directly; swap to Alembic migrations once the
		# schema needs to evolve in production
		db.create_all()

	return app
