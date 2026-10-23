import os
import datetime
from flask import Flask, jsonify
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS

from app.db import close_db


class ISODateJSONProvider(DefaultJSONProvider):
    """
    Le provider JSON par défaut de Flask sérialise les `date`/`datetime` au format
    HTTP (RFC 822, ex. "Sun, 20 Apr 2025 00:00:00 GMT") plutôt qu'en ISO 8601.
    Les colonnes DATE (sowingDate, harvestDate, ...) remontées par mysql-connector
    sous forme de `datetime.date` héritaient donc de ce format non-ISO, que les
    <input type="date"> du frontend (qui exigent strictement "YYYY-MM-DD") ne
    peuvent pas parser : les champs de date restaient vides en édition.
    """
    @staticmethod
    def default(o):
        if isinstance(o, (datetime.date, datetime.datetime)):
            return o.isoformat()
        if isinstance(o, datetime.timedelta):
            # Les colonnes TIME (ex. eventTime) remontent en `timedelta` avec mysql-connector.
            # L'API les documente en "HH:MM:SS" (voir API_DOCUMENTATION.md).
            total_seconds = int(o.total_seconds())
            hours, remainder = divmod(total_seconds, 3600)
            minutes, seconds = divmod(remainder, 60)
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        return DefaultJSONProvider.default(o)
from app.routes.public import bp as public_bp
from app.routes.exploitations import bp as exploitations_bp
from app.routes.parcels import bp as parcels_bp
from app.routes.operators import bp as operators_bp
from app.routes.crops import bp as crops_bp
from app.routes.inventories import bp as inventories_bp
from app.routes.phyto_treatments import bp as phyto_bp
from app.routes.field_works import bp as field_works_bp
from app.routes.personal_products import bp as personal_products_bp
from app.routes.admin import bp as admin_bp
from app.routes.mandates import bp as mandates_bp
from app.routes.user_profile import bp as user_profile_bp
from app.routes.preferences import bp as preferences_bp
from app.routes.exports import bp as exports_bp
from app.routes.formations import bp as formations_bp
from app.routes.phytoweb_categories import bp as phytoweb_categories_bp
from app.routes.session import bp as session_bp
from app.routes.wallesmart import bp as wallesmart_bp


def create_app():
    app = Flask(__name__)
    app.json_provider_class = ISODateJSONProvider
    app.json = ISODateJSONProvider(app)

    # ALLOWED_ORIGINS : liste d'origines séparées par des virgules (ex. "https://app.example.be,http://localhost:4200").
    # Non défini -> "*" (comportement actuel), à restreindre en production.
    allowed_origins = os.getenv("ALLOWED_ORIGINS")
    origins = [o.strip() for o in allowed_origins.split(",")] if allowed_origins else "*"
    CORS(app, resources={r"/*": {"origins": origins}}, supports_credentials=True)
    app.teardown_appcontext(close_db)

    @app.errorhandler(404)
    def handle_not_found(e):
        return jsonify({"error": "Ressource introuvable"}), 404

    @app.errorhandler(405)
    def handle_method_not_allowed(e):
        return jsonify({"error": "Méthode non autorisée"}), 405

    @app.errorhandler(500)
    def handle_internal_error(e):
        return jsonify({"error": "Erreur interne du serveur"}), 500

    app.register_blueprint(public_bp)
    app.register_blueprint(exploitations_bp)
    app.register_blueprint(parcels_bp)
    app.register_blueprint(operators_bp)
    app.register_blueprint(crops_bp)
    app.register_blueprint(inventories_bp)
    app.register_blueprint(phyto_bp)
    app.register_blueprint(field_works_bp)
    app.register_blueprint(personal_products_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(mandates_bp)
    app.register_blueprint(user_profile_bp)
    app.register_blueprint(preferences_bp)
    app.register_blueprint(exports_bp)
    app.register_blueprint(formations_bp)
    app.register_blueprint(phytoweb_categories_bp)
    app.register_blueprint(session_bp)
    app.register_blueprint(wallesmart_bp)

    return app
