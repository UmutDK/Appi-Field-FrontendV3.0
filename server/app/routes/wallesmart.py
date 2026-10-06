"""
Statut de liaison WalleSmart du compte connecté.
Remplace previousServer/wallesmart_status.php + wallesmart_utils.php.
La vérification de liaison se fait auprès de UserKey (WES_CHECK_MAIL_URL),
avec le token de session de l'utilisateur lui-même (pas de secret serveur).
"""
import os
import requests
from flask import Blueprint, jsonify, request
from app.auth import require_auth, extract_token, get_user_mail_from_token

bp = Blueprint("wallesmart", __name__, url_prefix="/wallesmart")

WES_CHECK_MAIL_URL = os.getenv(
    "WES_CHECK_MAIL_URL", "https://userkey.corderapp.be/controllers/wallesmart/check_mail.php"
)


def _check_wallesmart_linked(mail: str, token: str) -> bool:
    try:
        resp = requests.get(
            WES_CHECK_MAIL_URL,
            params={"mail": mail},
            headers={"Authorization": f"Bearer {token}"},
            timeout=8,
            verify=False,
        )
        if resp.status_code != 200:
            return False
        data = resp.json()
    except Exception:
        return False
    return data.get("data", {}).get("exists") is True


@bp.get("/status")
@require_auth
def get_wallesmart_status(user_id):
    token = extract_token(request)
    mail = get_user_mail_from_token(token)
    if not mail:
        return jsonify({"linked": False, "mail": None})
    linked = _check_wallesmart_linked(mail, token)
    return jsonify({"linked": linked, "mail": mail})
