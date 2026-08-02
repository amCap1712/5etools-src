import re

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash

from ..auth_utils import auth_required, make_token
from ..extensions import db
from ..models import Profile, User

bp = Blueprint("auth", __name__)

USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _auth_response(user, status=200):
	return jsonify({"token": make_token(user), "user": user.to_dict()}), status


def _ensure_profile(user):
	if user.profile is None:
		user.profile = Profile(user_id=user.id)


@bp.get("/config")
def get_config():
	return jsonify({"googleClientId": current_app.config["GOOGLE_CLIENT_ID"]})


@bp.post("/register")
def register():
	body = request.get_json(silent=True) or {}
	username = (body.get("username") or "").strip()
	email = (body.get("email") or "").strip().lower()
	password = body.get("password") or ""

	if not USERNAME_RE.match(username):
		return jsonify({"error": "Username must be 3-32 characters: letters, numbers, _ or -"}), 400
	if not EMAIL_RE.match(email):
		return jsonify({"error": "A valid email address is required"}), 400
	if len(password) < 8:
		return jsonify({"error": "Password must be at least 8 characters"}), 400

	if db.session.query(User.id).filter(func.lower(User.username) == username.lower()).first():
		return jsonify({"error": "That username is already taken"}), 409
	if db.session.query(User.id).filter(User.email == email).first():
		return jsonify({"error": "An account with that email already exists"}), 409

	user = User(username=username, email=email, password_hash=generate_password_hash(password))
	db.session.add(user)
	db.session.flush()
	_ensure_profile(user)
	db.session.commit()
	return _auth_response(user, status=201)


@bp.post("/login")
def login():
	body = request.get_json(silent=True) or {}
	identifier = (body.get("username") or body.get("email") or "").strip()
	password = body.get("password") or ""
	if not identifier or not password:
		return jsonify({"error": "Username/email and password are required"}), 400

	user = (
		db.session.query(User)
		.filter(
			(func.lower(User.username) == identifier.lower())
			| (User.email == identifier.lower())
		)
		.first()
	)
	if user is None or not user.password_hash or not check_password_hash(user.password_hash, password):
		return jsonify({"error": "Invalid credentials"}), 401
	return _auth_response(user)


def _unique_username_from_email(email):
	base = re.sub(r"[^A-Za-z0-9_-]", "", email.split("@")[0])[:24] or "adventurer"
	if len(base) < 3:
		base = f"{base}hero"
	candidate = base
	suffix = 1
	while db.session.query(User.id).filter(func.lower(User.username) == candidate.lower()).first():
		suffix += 1
		candidate = f"{base}{suffix}"
	return candidate


@bp.post("/google")
def google_login():
	client_id = current_app.config["GOOGLE_CLIENT_ID"]
	if not client_id:
		return jsonify({"error": "Google Sign-In is not configured on this server"}), 501

	body = request.get_json(silent=True) or {}
	credential = body.get("credential")
	if not credential:
		return jsonify({"error": "Missing Google credential"}), 400

	from google.auth.transport import requests as google_requests
	from google.oauth2 import id_token as google_id_token

	try:
		info = google_id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
	except ValueError:
		return jsonify({"error": "Invalid Google credential"}), 401

	google_sub = info["sub"]
	email = (info.get("email") or "").lower()

	user = db.session.query(User).filter(User.google_sub == google_sub).first()
	if user is None and email:
		# Link to an existing password account with the same (verified) email
		if info.get("email_verified"):
			user = db.session.query(User).filter(User.email == email).first()
			if user is not None:
				user.google_sub = google_sub
	if user is None:
		if not email:
			return jsonify({"error": "Google account has no email address"}), 400
		user = User(username=_unique_username_from_email(email), email=email, google_sub=google_sub)
		db.session.add(user)
		db.session.flush()
		_ensure_profile(user)
		if info.get("name") and user.profile.display_name is None:
			user.profile.display_name = info["name"][:64]
	db.session.commit()
	return _auth_response(user)


@bp.get("/me")
@auth_required
def me():
	_ensure_profile(g.current_user)
	db.session.commit()
	return jsonify({"user": g.current_user.to_dict()})


@bp.post("/password")
@auth_required
def change_password():
	body = request.get_json(silent=True) or {}
	new_password = body.get("newPassword") or ""
	current = body.get("currentPassword") or ""
	user = g.current_user

	if len(new_password) < 8:
		return jsonify({"error": "Password must be at least 8 characters"}), 400
	if user.password_hash and not check_password_hash(user.password_hash, current):
		return jsonify({"error": "Current password is incorrect"}), 401

	user.password_hash = generate_password_hash(new_password)
	db.session.commit()
	return jsonify({"user": user.to_dict()})
