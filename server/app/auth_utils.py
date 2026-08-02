from datetime import timedelta
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request

from .extensions import db
from .models import User, utcnow


def make_token(user):
	payload = {
		"sub": str(user.id),
		"iat": utcnow(),
		"exp": utcnow() + timedelta(days=current_app.config["JWT_EXPIRY_DAYS"]),
	}
	return jwt.encode(payload, current_app.config["SECRET_KEY"], algorithm="HS256")


def _user_from_request():
	header = request.headers.get("Authorization", "")
	if not header.startswith("Bearer "):
		return None
	token = header[len("Bearer "):].strip()
	try:
		payload = jwt.decode(token, current_app.config["SECRET_KEY"], algorithms=["HS256"])
	except jwt.PyJWTError:
		return None
	try:
		user_id = int(payload.get("sub", ""))
	except (TypeError, ValueError):
		return None
	return db.session.get(User, user_id)


def auth_required(fn):
	@wraps(fn)
	def wrapper(*args, **kwargs):
		user = _user_from_request()
		if user is None:
			return jsonify({"error": "Authentication required"}), 401
		g.current_user = user
		return fn(*args, **kwargs)
	return wrapper
