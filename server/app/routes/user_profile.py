"""
Profil déclaratif de l'utilisateur (phytolicence, n° exploitant).
Schéma DB : table `userProfile`, une ligne par utilisateur (upsert).
Remplace previousServer/users_infos.json.
"""
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth

bp = Blueprint("user_profile", __name__, url_prefix="/user_profile")


@bp.get("")
@require_auth
def get_user_profile(user_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM userProfile WHERE userId = %s", (user_id,))
    return jsonify(cur.fetchone())


@bp.post("")
@require_auth
def upsert_user_profile(user_id):
    data = request.get_json(force=True)
    cur = cursor_appifield()
    cur.execute(
        """INSERT INTO userProfile (userId, phytolicence, exploitingNumber)
           VALUES (%s, %s, %s)
           ON DUPLICATE KEY UPDATE phytolicence = VALUES(phytolicence), exploitingNumber = VALUES(exploitingNumber)""",
        (user_id, data.get("phytolicence"), data.get("exploitingNumber")),
    )
    commit_appifield()
    return jsonify({"success": True})
