"""
Statut admin de l'utilisateur connecté.
Remplace l'ancien contrôle côté frontend (admin.service.ts comparait un champ
externe à des valeurs codées en dur dans le bundle JS) par une vérification
serveur contre la table `admins`.
"""
from flask import Blueprint, jsonify
from app.auth import require_auth, is_admin

bp = Blueprint("admin", __name__, url_prefix="/admin")


@bp.get("/status")
@require_auth
def get_admin_status(user_id):
    return jsonify({"isAdmin": is_admin(user_id)})
