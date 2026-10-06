"""
Mandats / délégation entre comptes.
Schéma DB : table `mandates` (voir migrations/002_add_mandates_table.sql).

Un utilisateur (owner) invite un autre utilisateur par email (mandataire) à accéder
à ses données. Tant que le mandataire ne s'est jamais authentifié sur l'API,
mandateUserId reste NULL et la demande n'est identifiable que par mandateUserMail ;
elle se résout automatiquement au premier GET fait par ce mandataire (son mail,
récupéré depuis le token, matche alors mandateUserMail).

Une fois `accepted`, le mandataire peut agir sur les données du owner en envoyant
le header `X-Workspace-UserId: <ownerUserId>` (résolu dans app.auth.require_auth).
"""
import uuid
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth_self, extract_token, get_user_mail_from_token

bp = Blueprint("mandates", __name__, url_prefix="/mandates")


def _resolve_pending_mandates_for_mail(user_id: str, mail: str):
    """Rattache à user_id les mandats en attente dont le mail cible correspond au sien."""
    if not mail:
        return
    cur = cursor_appifield()
    cur.execute(
        "UPDATE mandates SET mandateUserId = %s WHERE mandateUserId IS NULL AND LOWER(mandateUserMail) = LOWER(%s)",
        (user_id, mail),
    )
    commit_appifield()


def _get_exploitation_name(user_id: str) -> str:
    cur = cursor_appifield()
    cur.execute("SELECT exploitationName FROM exploitations WHERE userId = %s LIMIT 1", (user_id,))
    row = cur.fetchone()
    return row["exploitationName"] if row and row.get("exploitationName") else ""


@bp.get("")
@require_auth_self
def get_mandates(user_id):
    mail = get_user_mail_from_token(extract_token(request)) or ""
    _resolve_pending_mandates_for_mail(user_id, mail)

    cur = cursor_appifield()
    cur.execute(
        """SELECT * FROM mandates
           WHERE ownerUserId = %s OR mandateUserId = %s OR LOWER(mandateUserMail) = LOWER(%s)
           ORDER BY createdAt DESC""",
        (user_id, user_id, mail),
    )
    return jsonify(cur.fetchall())


@bp.post("")
@require_auth_self
def create_mandate(user_id):
    data = request.get_json(force=True)
    target_mail = (data.get("mandateUserMail") or "").strip().lower()
    if not target_mail:
        return jsonify({"error": "mandateUserMail requis"}), 400

    owner_mail = get_user_mail_from_token(extract_token(request)) or ""
    if owner_mail.lower() == target_mail:
        return jsonify({"error": "Impossible de créer un mandat vers son propre compte"}), 400

    cur = cursor_appifield()
    cur.execute(
        """SELECT 1 FROM mandates WHERE ownerUserId = %s AND LOWER(mandateUserMail) = %s
           AND status IN ('pending', 'accepted')""",
        (user_id, target_mail),
    )
    if cur.fetchone():
        return jsonify({"error": "Un mandat existe déjà pour ce compte"}), 409

    mandate_id = str(uuid.uuid4())
    mandate_name = _get_exploitation_name(user_id) or f"Exploitation de {owner_mail or user_id}"
    cur.execute(
        """INSERT INTO mandates
            (mandateId, mandateName, ownerUserId, ownerUserMail, mandateUserId, mandateUserMail, status)
           VALUES (%s, %s, %s, %s, NULL, %s, 'pending')""",
        (mandate_id, mandate_name, user_id, owner_mail, target_mail),
    )
    commit_appifield()
    return jsonify({"success": True, "mandateId": mandate_id}), 201


@bp.put("/<mandate_id>")
@require_auth_self
def update_mandate_status(user_id, mandate_id):
    data = request.get_json(force=True)
    new_status = data.get("status")
    if new_status not in ("accepted", "refused"):
        return jsonify({"error": "status doit être 'accepted' ou 'refused'"}), 400

    mail = get_user_mail_from_token(extract_token(request)) or ""
    cur = cursor_appifield()
    cur.execute("SELECT * FROM mandates WHERE mandateId = %s", (mandate_id,))
    mandate = cur.fetchone()
    if not mandate:
        return jsonify({"error": "Mandat non trouvé"}), 404

    is_mandatee = mandate["mandateUserId"] == user_id or (
        mandate["mandateUserId"] is None and mandate["mandateUserMail"].lower() == mail.lower()
    )
    if not is_mandatee:
        return jsonify({"error": "Seul le mandataire peut accepter ou refuser ce mandat"}), 403

    cur.execute(
        "UPDATE mandates SET status = %s, mandateUserId = %s WHERE mandateId = %s",
        (new_status, user_id, mandate_id),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.delete("/<mandate_id>")
@require_auth_self
def delete_mandate(user_id, mandate_id):
    mail = get_user_mail_from_token(extract_token(request)) or ""
    cur = cursor_appifield()
    cur.execute(
        """DELETE FROM mandates WHERE mandateId = %s
           AND (ownerUserId = %s OR mandateUserId = %s OR LOWER(mandateUserMail) = LOWER(%s))""",
        (mandate_id, user_id, user_id, mail),
    )
    commit_appifield()
    if cur.rowcount == 0:
        return jsonify({"error": "Mandat non trouvé ou accès refusé"}), 404
    return jsonify({"success": True})
