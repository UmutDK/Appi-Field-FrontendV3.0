"""
Calendrier de formations (annonces affichées en accueil/back-office).
Schéma DB : table `formations` (voir migrations/004_add_formations_table.sql).
Lecture réservée aux utilisateurs authentifiés, écriture réservée aux admins
(l'ancien previousServer/formations_manager.php n'avait aucune auth du tout).
"""
import uuid
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth, require_admin

bp = Blueprint("formations", __name__, url_prefix="/formations")


@bp.get("")
@require_auth
def get_formations(user_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM formations ORDER BY orderIndex")
    return jsonify(cur.fetchall())


@bp.post("")
@require_admin
def create_formation(user_id):
    data = request.get_json(force=True)
    formation_id = str(uuid.uuid4())

    cur = cursor_appifield()
    cur.execute("SELECT COALESCE(MAX(orderIndex), -1) + 1 AS nextIndex FROM formations")
    next_index = cur.fetchone()["nextIndex"]

    cur.execute(
        """INSERT INTO formations (formationId, day, month, title, location, time, link, orderIndex)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            formation_id, data.get("day"), data.get("month"), data.get("title"),
            data.get("location"), data.get("time"), data.get("link"), next_index,
        ),
    )
    commit_appifield()
    return jsonify({"success": True, "formationId": formation_id}), 201


@bp.put("/<formation_id>")
@require_admin
def update_formation(user_id, formation_id):
    data = request.get_json(force=True)
    cur = cursor_appifield()
    cur.execute(
        """UPDATE formations SET day = %s, month = %s, title = %s, location = %s, time = %s, link = %s
           WHERE formationId = %s""",
        (
            data.get("day"), data.get("month"), data.get("title"),
            data.get("location"), data.get("time"), data.get("link"), formation_id,
        ),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.delete("/<formation_id>")
@require_admin
def delete_formation(user_id, formation_id):
    cur = cursor_appifield()
    cur.execute("DELETE FROM formations WHERE formationId = %s", (formation_id,))
    commit_appifield()
    return jsonify({"success": True})


@bp.put("/<formation_id>/move")
@require_admin
def move_formation(user_id, formation_id):
    """Body : { direction: 'up' | 'down' } — permute orderIndex avec le voisin dans ce sens."""
    direction = (request.get_json(force=True) or {}).get("direction")
    if direction not in ("up", "down"):
        return jsonify({"error": "direction doit être 'up' ou 'down'"}), 400

    cur = cursor_appifield()
    cur.execute("SELECT formationId, orderIndex FROM formations WHERE formationId = %s", (formation_id,))
    current = cur.fetchone()
    if not current:
        return jsonify({"error": "Formation non trouvée"}), 404

    if direction == "up":
        cur.execute(
            "SELECT formationId, orderIndex FROM formations WHERE orderIndex < %s ORDER BY orderIndex DESC LIMIT 1",
            (current["orderIndex"],),
        )
    else:
        cur.execute(
            "SELECT formationId, orderIndex FROM formations WHERE orderIndex > %s ORDER BY orderIndex ASC LIMIT 1",
            (current["orderIndex"],),
        )
    neighbor = cur.fetchone()
    if not neighbor:
        return jsonify({"success": True})  # déjà en bout de liste, rien à faire

    cur.execute("UPDATE formations SET orderIndex = %s WHERE formationId = %s", (neighbor["orderIndex"], current["formationId"]))
    cur.execute("UPDATE formations SET orderIndex = %s WHERE formationId = %s", (current["orderIndex"], neighbor["formationId"]))
    commit_appifield()
    return jsonify({"success": True})
