"""
Routes pour les produits personnalisés (engrais, produits hors phytoweb).
Schéma DB : table `personalProducts` (voir database/init_first_db.py).
Colonnes : productId, userId, productName, productType.
"""
import uuid
from flask import Blueprint, jsonify, request
from app.db import cursor_appifield, commit_appifield
from app.auth import require_auth

bp = Blueprint("personal_products", __name__, url_prefix="/personal_products")


@bp.get("")
@require_auth
def get_personal_products(user_id):
    cur = cursor_appifield()
    cur.execute("SELECT * FROM personalProducts WHERE userId = %s", (user_id,))
    return jsonify(cur.fetchall())


@bp.post("")
@require_auth
def create_personal_product(user_id):
    data = request.get_json(force=True)
    if not data.get("productName"):
        return jsonify({"error": "Le nom du produit est obligatoire"}), 400
    product_id = "perso-" + str(uuid.uuid4())
    cur = cursor_appifield()
    cur.execute(
        "INSERT INTO personalProducts (productId, userId, productName, productType) VALUES (%s, %s, %s, %s)",
        (product_id, user_id, data["productName"].strip(), data.get("productType", "autre").strip()),
    )
    commit_appifield()
    return jsonify({"success": True, "productId": product_id}), 201


@bp.put("/<product_id>")
@require_auth
def update_personal_product(user_id, product_id):
    data = request.get_json(force=True)
    if not data.get("productName"):
        return jsonify({"error": "Le nom du produit est obligatoire"}), 400
    cur = cursor_appifield()
    cur.execute(
        "UPDATE personalProducts SET productName = %s, productType = %s WHERE productId = %s AND userId = %s",
        (data["productName"].strip(), data.get("productType", "autre").strip(), product_id, user_id),
    )
    commit_appifield()
    return jsonify({"success": True})


@bp.delete("/<product_id>")
@require_auth
def delete_personal_product(user_id, product_id):
    cur = cursor_appifield()
    cur.execute(
        "DELETE FROM personalProducts WHERE productId = %s AND userId = %s",
        (product_id, user_id),
    )
    commit_appifield()
    return jsonify({"success": True})
