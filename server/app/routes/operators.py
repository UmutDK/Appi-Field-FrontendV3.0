"""
Routes pour les opérateurs (personnes habilitées à intervenir).
Schéma DB : table `operators` (voir database/init_first_db.py).
Colonnes : operatorId, userId, operatorName, operatorPhytolicence.
"""
import uuid
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth

bp = Blueprint("operators", __name__, url_prefix="/operators")


@bp.get("")
@require_auth
def get_operators(user_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM operators WHERE userId = %s", (user_id,))
    return jsonify(cur.fetchall())


@bp.post("")
@require_auth
def create_operator(user_id):
    data = request.get_json(force=True)
    if not data.get("operatorName"):
        return jsonify({"error": "operatorName requis"}), 400
    new_id = data.get("operatorId") or str(uuid.uuid4())
    cur = cursor_appifield()
    cur.execute(
        """INSERT INTO operators (operatorId, userId, operatorName, operatorPhytolicence)
           VALUES (%s, %s, %s, %s)""",
        (new_id, user_id, data.get("operatorName"), data.get("operatorPhytolicence")),
    )
    commit_appifield()
    return jsonify({"success": True, "operatorId": new_id}), 201


@bp.put("/<operator_id>")
@require_auth
def update_operator(user_id, operator_id):
    data = request.get_json(force=True)
    cur = cursor_appifield()
    cur.execute(
        """UPDATE operators SET operatorName = %s, operatorPhytolicence = %s
           WHERE operatorId = %s AND userId = %s""",
        (data.get("operatorName"), data.get("operatorPhytolicence"), operator_id, user_id),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.delete("/<operator_id>")
@require_auth
def delete_operator(user_id, operator_id):
    cur = cursor_appifield()
    cur.execute("DELETE FROM operators WHERE operatorId = %s AND userId = %s", (operator_id, user_id))
    commit_appifield()
    return jsonify({"success": True})
