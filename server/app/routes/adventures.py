import secrets

from flask import Blueprint, g, jsonify, request

from ..auth_utils import auth_required
from ..extensions import db
from ..models import (
	ADVENTURE_STATUSES,
	DM_ONLY_EVENT_TYPES,
	EVENT_TYPES,
	Adventure,
	AdventureEvent,
	AdventureMember,
	Character,
)

bp = Blueprint("adventures", __name__)

# No easily-confused characters (0/O, 1/I/L)
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def _new_join_code():
	while True:
		code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
		if not db.session.query(Adventure.id).filter(Adventure.join_code == code).first():
			return code


def _get_membership(adventure_id):
	return (
		db.session.query(AdventureMember)
		.filter(
			AdventureMember.adventure_id == adventure_id,
			AdventureMember.user_id == g.current_user.id,
		)
		.first()
	)


def _require_member(adventure_id):
	adventure = db.session.get(Adventure, adventure_id)
	if adventure is None:
		return None, None, (jsonify({"error": "Adventure not found"}), 404)
	member = _get_membership(adventure_id)
	if member is None:
		return None, None, (jsonify({"error": "You are not a member of this adventure"}), 403)
	return adventure, member, None


def _log_system(adventure, content, data=None):
	db.session.add(AdventureEvent(
		adventure_id=adventure.id,
		type="system",
		content=content,
		data=data,
	))


def _own_character_or_error(character_id):
	character = db.session.get(Character, character_id)
	if character is None or character.user_id != g.current_user.id:
		return None, (jsonify({"error": "Character not found among your characters"}), 400)
	return character, None


@bp.get("/adventures")
@auth_required
def list_adventures():
	memberships = (
		db.session.query(AdventureMember)
		.filter(AdventureMember.user_id == g.current_user.id)
		.all()
	)
	out = []
	for member in memberships:
		adventure = member.adventure
		out.append(adventure.to_dict(include_code=member.role == "dm", role=member.role))
	out.sort(key=lambda a: a["createdAt"] or "", reverse=True)
	return jsonify({"adventures": out})


@bp.post("/adventures")
@auth_required
def create_adventure():
	body = request.get_json(silent=True) or {}
	name = (body.get("name") or "").strip()
	if not name or len(name) > 128:
		return jsonify({"error": "An adventure name (1-128 characters) is required"}), 400

	adventure = Adventure(
		name=name,
		description=(body.get("description") or "").strip() or None,
		join_code=_new_join_code(),
		created_by=g.current_user.id,
	)
	db.session.add(adventure)
	db.session.flush()

	member = AdventureMember(adventure_id=adventure.id, user_id=g.current_user.id, role="dm")
	db.session.add(member)
	db.session.flush()
	_log_system(adventure, f"{member.display_name()} founded the adventure. The tale begins!")
	db.session.commit()
	return jsonify({"adventure": adventure.to_dict(include_code=True, include_members=True, role="dm")}), 201


@bp.post("/adventures/join")
@auth_required
def join_adventure():
	body = request.get_json(silent=True) or {}
	code = (body.get("code") or "").strip().upper()
	if not code:
		return jsonify({"error": "A join code is required"}), 400

	adventure = db.session.query(Adventure).filter(Adventure.join_code == code).first()
	if adventure is None:
		return jsonify({"error": "No adventure found for that code"}), 404
	if adventure.status in ("completed", "archived"):
		return jsonify({"error": "This adventure is no longer accepting members"}), 409
	if _get_membership(adventure.id):
		return jsonify({"error": "You are already a member of this adventure"}), 409

	character = None
	if body.get("characterId") is not None:
		character, error_response = _own_character_or_error(body["characterId"])
		if error_response:
			return error_response

	member = AdventureMember(
		adventure_id=adventure.id,
		user_id=g.current_user.id,
		role="player",
		character_id=character.id if character else None,
	)
	db.session.add(member)
	db.session.flush()
	joined_as = f" as {character.name}" if character else ""
	_log_system(adventure, f"{member.display_name()} joined the party{joined_as}.")
	db.session.commit()
	return jsonify({"adventure": adventure.to_dict(include_members=True, role="player")}), 201


@bp.get("/adventures/<int:adventure_id>")
@auth_required
def get_adventure(adventure_id):
	adventure, member, error_response = _require_member(adventure_id)
	if error_response:
		return error_response
	return jsonify({
		"adventure": adventure.to_dict(include_code=member.role == "dm", include_members=True, role=member.role),
	})


@bp.put("/adventures/<int:adventure_id>")
@auth_required
def update_adventure(adventure_id):
	adventure, member, error_response = _require_member(adventure_id)
	if error_response:
		return error_response
	if member.role != "dm":
		return jsonify({"error": "Only the DM can update the adventure"}), 403

	body = request.get_json(silent=True) or {}
	if "name" in body:
		name = (body["name"] or "").strip()
		if not name or len(name) > 128:
			return jsonify({"error": "An adventure name (1-128 characters) is required"}), 400
		adventure.name = name
	if "description" in body:
		adventure.description = (body["description"] or "").strip() or None
	if "status" in body:
		if body["status"] not in ADVENTURE_STATUSES:
			return jsonify({"error": f"status must be one of: {', '.join(ADVENTURE_STATUSES)}"}), 400
		if body["status"] != adventure.status:
			_log_system(adventure, f"The adventure is now {body['status']}.")
		adventure.status = body["status"]
	if "settings" in body:
		if body["settings"] is not None and not isinstance(body["settings"], dict):
			return jsonify({"error": "settings must be an object"}), 400
		adventure.settings = body["settings"]
	if body.get("regenerateJoinCode"):
		adventure.join_code = _new_join_code()

	db.session.commit()
	return jsonify({"adventure": adventure.to_dict(include_code=True, include_members=True, role="dm")})


@bp.put("/adventures/<int:adventure_id>/members/me")
@auth_required
def update_my_membership(adventure_id):
	adventure, member, error_response = _require_member(adventure_id)
	if error_response:
		return error_response
	body = request.get_json(silent=True) or {}

	if "characterId" in body:
		if body["characterId"] is None:
			member.character_id = None
		else:
			character, char_error = _own_character_or_error(body["characterId"])
			if char_error:
				return char_error
			if member.character_id != character.id:
				_log_system(adventure, f"{member.display_name()} now plays {character.name}.")
			member.character_id = character.id
	db.session.commit()
	return jsonify({"member": member.to_dict()})


@bp.delete("/adventures/<int:adventure_id>/members/<int:member_id>")
@auth_required
def remove_member(adventure_id, member_id):
	adventure, me, error_response = _require_member(adventure_id)
	if error_response:
		return error_response

	target = db.session.get(AdventureMember, member_id)
	if target is None or target.adventure_id != adventure_id:
		return jsonify({"error": "Member not found"}), 404
	if target.id != me.id and me.role != "dm":
		return jsonify({"error": "Only the DM can remove other members"}), 403
	if target.role == "dm":
		dm_count = (
			db.session.query(AdventureMember)
			.filter(AdventureMember.adventure_id == adventure_id, AdventureMember.role == "dm")
			.count()
		)
		if dm_count <= 1:
			return jsonify({"error": "The last DM cannot leave; archive the adventure instead"}), 409

	verb = "left the party" if target.id == me.id else "was removed from the party"
	_log_system(adventure, f"{target.display_name()} {verb}.")
	db.session.delete(target)
	db.session.commit()
	return jsonify({"ok": True})


@bp.get("/adventures/<int:adventure_id>/events")
@auth_required
def list_events(adventure_id):
	adventure, member, error_response = _require_member(adventure_id)
	if error_response:
		return error_response

	try:
		after = int(request.args.get("after", 0))
		limit = min(max(int(request.args.get("limit", 200)), 1), 500)
	except ValueError:
		return jsonify({"error": "after and limit must be numbers"}), 400

	events = (
		db.session.query(AdventureEvent)
		.filter(AdventureEvent.adventure_id == adventure_id, AdventureEvent.id > after)
		.order_by(AdventureEvent.id.asc())
		.limit(limit)
		.all()
	)
	return jsonify({
		"events": [e.to_dict() for e in events],
		"lastId": events[-1].id if events else after,
	})


@bp.post("/adventures/<int:adventure_id>/events")
@auth_required
def create_event(adventure_id):
	adventure, member, error_response = _require_member(adventure_id)
	if error_response:
		return error_response

	body = request.get_json(silent=True) or {}
	event_type = body.get("type")
	content = (body.get("content") or "").strip()
	data = body.get("data")

	if event_type not in EVENT_TYPES or event_type == "system":
		valid = ", ".join(t for t in EVENT_TYPES if t != "system")
		return jsonify({"error": f"type must be one of: {valid}"}), 400
	if event_type in DM_ONLY_EVENT_TYPES and member.role != "dm":
		return jsonify({"error": f"Only the DM can post {event_type} events"}), 403
	if not content and event_type != "roll":
		return jsonify({"error": "content is required"}), 400
	if len(content) > 10000:
		return jsonify({"error": "content must be at most 10000 characters"}), 400
	if data is not None and not isinstance(data, dict):
		return jsonify({"error": "data must be an object"}), 400

	event = AdventureEvent(
		adventure_id=adventure_id,
		member_id=member.id,
		author_name=member.display_name(),
		character_name=member.character.name if member.character else None,
		type=event_type,
		content=content,
		data=data,
	)
	db.session.add(event)
	db.session.commit()
	return jsonify({"event": event.to_dict()}), 201


@bp.delete("/adventures/<int:adventure_id>/events/<int:event_id>")
@auth_required
def delete_event(adventure_id, event_id):
	adventure, member, error_response = _require_member(adventure_id)
	if error_response:
		return error_response

	event = db.session.get(AdventureEvent, event_id)
	if event is None or event.adventure_id != adventure_id:
		return jsonify({"error": "Event not found"}), 404
	if member.role != "dm" and event.member_id != member.id:
		return jsonify({"error": "You can only delete your own events"}), 403

	db.session.delete(event)
	db.session.commit()
	return jsonify({"ok": True})
