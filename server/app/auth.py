import os
import time
import hashlib
from functools import wraps

import requests
from flask import request, jsonify
from dotenv import load_dotenv

from app.db import cursor_appifield

load_dotenv()

AUTH_VERIFY_URL = os.getenv("AUTH_VERIFY_URL", "https://userkey.corderapp.be/controllers/verification_token.php")
TOKEN_CACHE_TTL = int(os.getenv("TOKEN_CACHE_TTL", 1800))

# Cache en mémoire : { md5(token): {"user_id": str, "mail": str, "timestamp": float} }
_token_cache: dict = {}


def _cache_key(token: str) -> str:
    return hashlib.md5(token.encode()).hexdigest()


def _get_cached_info(token: str):
    key = _cache_key(token)
    entry = _token_cache.get(key)
    if entry and (time.time() - entry["timestamp"]) < TOKEN_CACHE_TTL:
        return entry
    if entry:
        del _token_cache[key]
    return None


def _cache_info(token: str, user_id: str, mail: str):
    _token_cache[_cache_key(token)] = {"user_id": user_id, "mail": mail, "timestamp": time.time()}


def _verify_token(token: str):
    """Vérifie un token Bearer auprès du service externe et retourne {"user_id", "mail"}, ou None si invalide."""
    if not token:
        return None

    cached = _get_cached_info(token)
    if cached:
        return cached

    try:
        resp = requests.get(
            AUTH_VERIFY_URL,
            params={"token": token},
            timeout=10,
            verify=False,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        user_id = data.get("Id_User")
        if user_id:
            user_id = str(user_id)
            mail = data.get("Mail", "")
            _cache_info(token, user_id, mail)
            return {"user_id": user_id, "mail": mail}
    except Exception:
        return None

    return None


def get_user_id_from_token(token: str):
    """Vérifie un token Bearer et retourne l'user_id, ou None si invalide."""
    info = _verify_token(token)
    return info["user_id"] if info else None


def get_user_mail_from_token(token: str):
    """Vérifie un token Bearer et retourne le mail associé, ou None si invalide."""
    info = _verify_token(token)
    return info["mail"] if info else None


def resolve_effective_user_id(token_user_id: str) -> str:
    """
    Si le header X-Workspace-UserId est présent et qu'un mandat 'accepted' existe
    entre le propriétaire visé (header) et l'utilisateur du token (mandataire),
    retourne l'id du propriétaire — sinon retourne l'id du token tel quel.
    """
    workspace_id = request.headers.get("X-Workspace-UserId")
    if not workspace_id or workspace_id == token_user_id:
        return token_user_id

    cur = cursor_appifield()
    cur.execute(
        "SELECT 1 FROM mandates WHERE ownerUserId = %s AND mandateUserId = %s AND status = 'accepted'",
        (workspace_id, token_user_id),
    )
    return workspace_id if cur.fetchone() else token_user_id


def extract_token(req) -> str | None:
    """Extrait le token depuis le header Authorization: Bearer <token>."""
    auth_header = req.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


def require_auth(f):
    """
    Décorateur : vérifie le token et injecte user_id dans kwargs.
    Si un header X-Workspace-UserId valide (mandat accepté) est présent, user_id
    devient celui du propriétaire délégué plutôt que celui du token connecté.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = extract_token(request)
        user_id = get_user_id_from_token(token)
        if not user_id:
            return jsonify({"error": "Token d'authentification invalide ou manquant"}), 401
        kwargs["user_id"] = resolve_effective_user_id(user_id)
        return f(*args, **kwargs)
    return decorated


def require_auth_self(f):
    """
    Comme require_auth, mais sans résolution de workspace délégué : injecte toujours
    l'user_id du token connecté. À utiliser pour tout ce qui concerne l'identité
    propre de l'utilisateur plutôt que les données d'une exploitation (ex. mandats).
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = extract_token(request)
        user_id = get_user_id_from_token(token)
        if not user_id:
            return jsonify({"error": "Token d'authentification invalide ou manquant"}), 401
        kwargs["user_id"] = user_id
        return f(*args, **kwargs)
    return decorated


def is_admin(user_id: str) -> bool:
    """Vérifie côté serveur (table `admins`) si l'utilisateur est admin."""
    cur = cursor_appifield()
    cur.execute("SELECT 1 FROM admins WHERE userId = %s", (user_id,))
    return cur.fetchone() is not None


def require_admin(f):
    """Décorateur : comme require_auth, mais exige en plus une entrée dans `admins`."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = extract_token(request)
        user_id = get_user_id_from_token(token)
        if not user_id:
            return jsonify({"error": "Token d'authentification invalide ou manquant"}), 401
        if not is_admin(user_id):
            return jsonify({"error": "Accès réservé aux administrateurs"}), 403
        kwargs["user_id"] = user_id
        return f(*args, **kwargs)
    return decorated
