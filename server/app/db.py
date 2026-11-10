import datetime
import decimal
import os
import re
import threading

import mysql.connector
import requests
from dotenv import load_dotenv
from flask import g

load_dotenv()

_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", 6))


# ── Accès à Phytoweb via le proxy HTTPS (server/phytoweb_proxy/index.php) ─────
# Utilisé quand DB_PHYTOWEB_PROXY_URL est défini : l'hébergement de l'API bloque les
# connexions MySQL sortantes (port 3306), le proxy exécute les SELECT sur le serveur de
# la base et renvoie le résultat en JSON. Le curseur imite celui de mysql-connector pour
# ce qu'en utilise le code (execute / fetchone / fetchall, dictionary=True|False) : les
# routes n'ont pas à savoir si Phytoweb est en direct ou derrière le proxy.

class PhytowebProxyError(Exception):
    """Proxy injoignable, jeton refusé ou requête rejetée/en erreur côté proxy."""


_proxy_local = threading.local()
_PLACEHOLDER = re.compile(r"%%|%s")


def _proxy_enabled() -> bool:
    return bool(os.getenv("DB_PHYTOWEB_PROXY_URL"))


def _proxy_session() -> requests.Session:
    session = getattr(_proxy_local, "session", None)
    if session is None:
        session = _proxy_local.session = requests.Session()
    return session


def _proxy_sql(sql: str) -> str:
    """Placeholders mysql-connector (%s, %% littéral) -> placeholders PDO (?, %)."""
    return _PLACEHOLDER.sub(lambda m: "?" if m.group() == "%s" else "%", sql)


def _proxy_param(value):
    if isinstance(value, (datetime.date, datetime.datetime, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value


class _ProxyCursor:
    def __init__(self, dictionary: bool):
        self._dictionary = dictionary
        self._rows: list = []
        self._pos = 0
        self.rowcount = -1
        self.column_names: tuple = ()

    def execute(self, sql, params=()):
        payload = {"sql": _proxy_sql(sql), "params": [_proxy_param(p) for p in (params or ())]}
        try:
            resp = _proxy_session().post(
                os.getenv("DB_PHYTOWEB_PROXY_URL"),
                json=payload,
                headers={"X-Proxy-Token": os.getenv("DB_PHYTOWEB_PROXY_TOKEN", "")},
                timeout=float(os.getenv("DB_PHYTOWEB_PROXY_TIMEOUT", 30)),
                verify=os.getenv("DB_PHYTOWEB_PROXY_VERIFY_SSL", "true").lower() == "true",
            )
        except requests.RequestException as exc:
            raise PhytowebProxyError(f"Proxy Phytoweb injoignable : {exc}") from exc
        try:
            data = resp.json()
        except ValueError:
            raise PhytowebProxyError(f"Réponse invalide du proxy Phytoweb (HTTP {resp.status_code})")
        if resp.status_code != 200:
            raise PhytowebProxyError(f"Proxy Phytoweb (HTTP {resp.status_code}) : {data.get('error')}")

        self.column_names = tuple(data["columns"])
        rows = data["rows"]
        self._rows = ([dict(zip(self.column_names, r)) for r in rows] if self._dictionary
                      else [tuple(r) for r in rows])
        self._pos = 0
        self.rowcount = len(self._rows)

    def fetchone(self):
        if self._pos >= len(self._rows):
            return None
        row = self._rows[self._pos]
        self._pos += 1
        return row

    def fetchall(self):
        rows, self._pos = self._rows[self._pos:], len(self._rows)
        return rows

    def __iter__(self):
        while (row := self.fetchone()) is not None:
            yield row

    def close(self):
        self._rows = []


class _ProxyConnection:
    def cursor(self, dictionary=False):
        return _ProxyCursor(dictionary)

    def close(self):
        pass


def _setting(prefix: str, key: str, default=None):
    """
    Paramètre de connexion d'une base : `<prefix>_<key>` (ex. DB_APPIFIELD_HOST) s'il est
    défini, sinon le paramètre commun `DB_<key>` (ex. DB_HOST). Permet d'héberger les deux
    bases sur des serveurs différents sans casser un .env qui n'utilise que DB_HOST/DB_USER/...
    """
    value = os.getenv(f"{prefix}_{key}")
    if value is None or value == "":
        value = os.getenv(f"DB_{key}", default)
    return value


def _connect(prefix: str, pool_name: str):
    """prefix : "DB_APPIFIELD" ou "DB_PHYTOWEB" (le nom de la base est la variable elle-même)."""
    return mysql.connector.connect(
        host=_setting(prefix, "HOST"),
        port=int(_setting(prefix, "PORT", 3306)),
        user=_setting(prefix, "USER"),
        password=_setting(prefix, "PASSWORD"),
        database=os.getenv(prefix),
        charset=os.getenv("DB_CHARSET", "utf8mb4"),
        autocommit=False,
        # Sans délai, une base injoignable (pare-feu, IP non autorisée dans « MySQL distant »)
        # bloque la requête jusqu'à ce que Passenger abandonne (502 « Incomplete response »).
        connection_timeout=int(_setting(prefix, "CONNECT_TIMEOUT", 10)),
        # L'hébergement mutualisé ne sert pas un TLS valide sur le port MySQL distant
        # (mysql-connector tente TLS par défaut -> "WRONG_VERSION_NUMBER"). Configurable
        # via .env si l'hébergeur active un jour un TLS correct sur ce port.
        ssl_disabled=_setting(prefix, "SSL_DISABLED", "true").lower() == "true",
        pool_name=pool_name,
        pool_size=_POOL_SIZE,
        pool_reset_session=True,
    )


def get_appifield():
    """
    Connexion appifield propre à la requête courante (stockée dans flask.g, tirée d'un pool).
    Le serveur de dev Flask est multi-threadé par défaut (threaded=True) : une connexion
    globale partagée entre threads provoquait des courses ("weakly-referenced object no
    longer exists", "Cursor is not connected") dès que deux requêtes arrivaient en parallèle
    (ex. plusieurs appels au chargement d'une page). Une connexion par requête élimine le partage.
    """
    if "conn_appifield" not in g:
        g.conn_appifield = _connect("DB_APPIFIELD", "appifield_pool")
    return g.conn_appifield


def get_phytoweb():
    """
    Retourne une connexion vers c2544857c_corderPhytoweb, propre à la requête courante :
    via le proxy HTTPS si DB_PHYTOWEB_PROXY_URL est défini, sinon en MySQL direct.
    """
    if "conn_phytoweb" not in g:
        g.conn_phytoweb = _ProxyConnection() if _proxy_enabled() else _connect("DB_PHYTOWEB", "phytoweb_pool")
    return g.conn_phytoweb


def cursor_appifield(dictionary=True):
    """Retourne un curseur sur appifield (résultats sous forme de dict par défaut)."""
    return get_appifield().cursor(dictionary=dictionary)


def cursor_phytoweb(dictionary=True):
    """Retourne un curseur sur corderPhytoweb (résultats sous forme de dict par défaut)."""
    return get_phytoweb().cursor(dictionary=dictionary)


def commit_appifield():
    get_appifield().commit()


def rollback_appifield():
    get_appifield().rollback()


def close_db(exception=None):
    """Rend les connexions de la requête à leur pool (appelé par teardown_appcontext)."""
    conn = g.pop("conn_appifield", None)
    if conn is not None:
        conn.close()
    conn = g.pop("conn_phytoweb", None)
    if conn is not None:
        conn.close()
