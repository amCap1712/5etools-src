from flask import Blueprint, g, jsonify, request

from ..auth_utils import auth_required
from ..extensions import db
from ..models import AdventureMember, Character
from ..uploads import delete_image, save_image

bp = Blueprint("characters", __name__)


def _get_owned(character_id):
	character = db.session.get(Character, character_id)
	if character is None:
		return None, (jsonify({"error": "Character not found"}), 404)
	if character.user_id != g.current_user.id:
		return None, (jsonify({"error": "You do not own this character"}), 403)
	return character, None


def _can_view(character):
	if character.user_id == g.current_user.id:
		return True
	# Fellow members of an adventure this character is enrolled in (e.g. the
	# DM) may view the sheet
	adventure_ids = [
		row.adventure_id
		for row in db.session.query(AdventureMember.adventure_id).filter(AdventureMember.character_id == character.id)
	]
	if not adventure_ids:
		return False
	return (
		db.session.query(AdventureMember.id)
		.filter(
			AdventureMember.user_id == g.current_user.id,
			AdventureMember.adventure_id.in_(adventure_ids),
		)
		.first()
		is not None
	)


def _apply_body(character, body):
	if "name" in body:
		name = (body["name"] or "").strip()
		if not name or len(name) > 128:
			return "A character name (1-128 characters) is required"
		character.name = name
	if "race" in body:
		character.race = (body["race"] or "").strip()[:64] or None
	if "className" in body:
		character.char_class = (body["className"] or "").strip()[:64] or None
	if "level" in body:
		try:
			level = int(body["level"])
		except (TypeError, ValueError):
			return "level must be a number"
		character.level = max(1, min(level, 20))
	if "isRetired" in body:
		character.is_retired = bool(body["isRetired"])
	if "sheet" in body:
		if not isinstance(body["sheet"], dict):
			return "sheet must be an object"
		character.sheet = body["sheet"]
	return None


@bp.get("/characters")
@auth_required
def list_characters():
	characters = (
		db.session.query(Character)
		.filter(Character.user_id == g.current_user.id)
		.order_by(Character.created_at.asc())
		.all()
	)
	return jsonify({"characters": [c.to_dict(summary=True) for c in characters]})


@bp.post("/characters")
@auth_required
def create_character():
	body = request.get_json(silent=True) or {}
	if not (body.get("name") or "").strip():
		return jsonify({"error": "A character name is required"}), 400
	character = Character(user_id=g.current_user.id, name="(unnamed)", sheet={})
	error = _apply_body(character, body)
	if error:
		return jsonify({"error": error}), 400
	db.session.add(character)
	db.session.commit()
	return jsonify({"character": character.to_dict()}), 201


@bp.get("/characters/<int:character_id>")
@auth_required
def get_character(character_id):
	character = db.session.get(Character, character_id)
	if character is None:
		return jsonify({"error": "Character not found"}), 404
	if not _can_view(character):
		return jsonify({"error": "You do not have access to this character"}), 403
	return jsonify({"character": character.to_dict()})


@bp.put("/characters/<int:character_id>")
@auth_required
def update_character(character_id):
	character, error_response = _get_owned(character_id)
	if error_response:
		return error_response
	error = _apply_body(character, request.get_json(silent=True) or {})
	if error:
		return jsonify({"error": error}), 400
	db.session.commit()
	return jsonify({"character": character.to_dict()})


@bp.delete("/characters/<int:character_id>")
@auth_required
def delete_character(character_id):
	character, error_response = _get_owned(character_id)
	if error_response:
		return error_response
	delete_image(character.portrait_path)
	db.session.delete(character)
	db.session.commit()
	return jsonify({"ok": True})


@bp.post("/characters/<int:character_id>/portrait")
@auth_required
def upload_portrait(character_id):
	character, error_response = _get_owned(character_id)
	if error_response:
		return error_response
	if "file" not in request.files:
		return jsonify({"error": "No file provided (use multipart field \"file\")"}), 400
	try:
		stored = save_image(request.files["file"])
	except ValueError as e:
		return jsonify({"error": str(e)}), 400
	delete_image(character.portrait_path)
	character.portrait_path = stored
	db.session.commit()
	return jsonify({"character": character.to_dict()})
