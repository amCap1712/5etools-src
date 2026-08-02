import os
import uuid

from flask import current_app

ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}


def save_image(file_storage):
	"""Save an uploaded image; returns the stored filename or raises ValueError."""
	filename = file_storage.filename or ""
	ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
	if ext not in ALLOWED_IMAGE_EXTENSIONS:
		raise ValueError(f"Unsupported image type; allowed: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}")
	stored = f"{uuid.uuid4().hex}.{ext}"
	file_storage.save(os.path.join(current_app.config["UPLOAD_DIR"], stored))
	return stored


def delete_image(stored_name):
	if not stored_name:
		return
	path = os.path.join(current_app.config["UPLOAD_DIR"], stored_name)
	try:
		os.remove(path)
	except OSError:
		pass
