"""
Vérification légère de session. Remplace previousServer/verify_session.php
(proxy CORS vers userkey) — ici le token est déjà validé par require_auth lui-même,
pas besoin d'un second aller-retour réseau.
"""
from flask import Blueprint, jsonify
from app.auth import require_auth

bp = Blueprint("session", __name__, url_prefix="/session")


@bp.get("/verify")
@require_auth
def verify_session(user_id):
    return jsonify({"valid": True, "userId": user_id})
