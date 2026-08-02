from urllib.parse import urlparse

from flask import Blueprint, g, jsonify, request

from ..auth_utils import auth_required
from ..extensions import db
from ..models import Profile
from ..uploads import delete_image, save_image

bp = Blueprint("profile", __name__)

_TEXT_FIELDS = {
	"displayName": ("display_name", 64),
	"pronouns": ("pronouns", 32),
	"location": ("location", 64),
}


def _normalize_website(value):
	"""Validate a website URL; returns (normalized, error). Bare domains get https://."""
	value = (value or "").strip()
	if not value:
		return None, None
	candidate = value if "://" in value else f"https://{value}"
	if len(candidate) > 255:
		return None, "website must be at most 255 characters"
	parsed = urlparse(candidate)
	host = parsed.hostname or ""
	if (
		parsed.scheme not in ("http", "https")
		or not host
		or ("." not in host and host != "localhost")
		or any(c.isspace() for c in candidate)
	):
		return None, "website must be a valid http(s) URL, e.g. https://example.com"
	return candidate, None


def _get_profile():
	if g.current_user.profile is None:
		g.current_user.profile = Profile(user_id=g.current_user.id)
	return g.current_user.profile


@bp.get("/profile")
@auth_required
def get_profile():
	profile = _get_profile()
	db.session.commit()
	return jsonify({"profile": profile.to_dict()})


@bp.put("/profile")
@auth_required
def update_profile():
	body = request.get_json(silent=True) or {}
	profile = _get_profile()

	for key, (attr, max_len) in _TEXT_FIELDS.items():
		if key in body:
			value = (body[key] or "").strip() or None
			if value and len(value) > max_len:
				return jsonify({"error": f"{key} must be at most {max_len} characters"}), 400
			setattr(profile, attr, value)

	if "website" in body:
		website, error = _normalize_website(body["website"])
		if error:
			return jsonify({"error": error}), 400
		profile.website = website

	if "bio" in body:
		bio = (body["bio"] or "").strip() or None
		if bio and len(bio) > 4000:
			return jsonify({"error": "bio must be at most 4000 characters"}), 400
		profile.bio = bio

	if "extra" in body:
		if body["extra"] is not None and not isinstance(body["extra"], dict):
			return jsonify({"error": "extra must be an object"}), 400
		profile.extra = body["extra"]

	db.session.commit()
	return jsonify({"profile": profile.to_dict()})


@bp.post("/profile/avatar")
@auth_required
def upload_avatar():
	if "file" not in request.files:
		return jsonify({"error": "No file provided (use multipart field \"file\")"}), 400
	profile = _get_profile()
	try:
		stored = save_image(request.files["file"])
	except ValueError as e:
		return jsonify({"error": str(e)}), 400
	delete_image(profile.avatar_path)
	profile.avatar_path = stored
	db.session.commit()
	return jsonify({"profile": profile.to_dict()})
