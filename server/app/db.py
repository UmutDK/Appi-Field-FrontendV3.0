import os
import mysql.connector
from dotenv import load_dotenv
from flask import g

load_dotenv()

_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", 6))


def _connect(database: str, pool_name: str):
    return mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=database,
        charset=os.getenv("DB_CHARSET", "utf8mb4"),
        autocommit=False,
        # L'hébergement mutualisé ne sert pas un TLS valide sur le port MySQL distant
        # (mysql-connector tente TLS par défaut -> "WRONG_VERSION_NUMBER"). Configurable
        # via .env si l'hébergeur active un jour un TLS correct sur ce port.
        ssl_disabled=os.getenv("DB_SSL_DISABLED", "true").lower() == "true",
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
        g.conn_appifield = _connect(os.getenv("DB_APPIFIELD"), "appifield_pool")
    return g.conn_appifield


def get_phytoweb():
    """Retourne une connexion vers c2544857c_corderPhytoweb, propre à la requête courante."""
    if "conn_phytoweb" not in g:
        g.conn_phytoweb = _connect(os.getenv("DB_PHYTOWEB"), "phytoweb_pool")
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
