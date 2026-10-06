"""
Routes publiques — référentiels phytoweb (pas d'authentification requise).
Toutes les données sont lues depuis c2544857c_corderPhytoweb, alimentée par le
pipeline ETL externe PhytowebCorder (cf. server/DOCUMENTATION_CorderPhytoweb.md).

Le schéma réel ne correspond PAS à ce que décrivait initialement API_DOCUMENTATION.md
(tables `products`/`crops`/`dosesMinMax`/`enemies`/`bbchWarnings` inexistantes) :
un acte d'autorisation vit dans `general`, ses cultures autorisées dans `crops`
(1 ligne par couple acte×culture, PAS un catalogue déduplicated), les cibles/doses
dans `targets`, et les catalogues dédupliqués dans `indexCrop`/`indexTarget`.

Les avertissements BBCH (stades d'application) sont dérivés de `crops.cropApplicationStade`
via /crop_authorizations, qui expose aussi les cultures autorisées et leur dose max par
acte. Le statut d'autorisation (vert/orange/rouge) est calculé dans /phytoweb_products à
partir de `general.statut` et `dates.useToleranceDate` (jointe sur idAct). Il n'existe
en revanche aucune donnée d'heure d'application collectée par le pipeline ETL — l'ancien
avertissement horaire est désormais dérivé côté frontend de `general.spe8Flag`.
"""
from flask import Blueprint, jsonify, request
from app.db import cursor_phytoweb

bp = Blueprint("public", __name__, url_prefix="/index")


@bp.get("/units")
def get_units():
    cur = cursor_phytoweb()
    cur.execute("SELECT idUnit, unitName, normalisationFactor FROM unitsIndex")
    return jsonify(cur.fetchall())


@bp.get("/phytoweb_products")
def get_phytoweb_products():
    """
    Catalogue des produits actuellement autorisés (actes les plus récents uniquement).
    Ajoute un statut d'autorisation calculé (authorizationStatus) et useToleranceDate
    (table `dates`, jointe 1:1 sur idAct) :
      - 'forbidden'   si statut == 'Retrait'
      - 'withdrawing' si statut contient 'Accord' ET useToleranceDate IS NOT NULL
      - 'authorized'  si statut contient 'Accord'
      - 'unknown'     sinon
    """
    cur = cursor_phytoweb()
    cur.execute(
        """SELECT g.*, d.useToleranceDate,
                  CASE
                      WHEN g.statut = 'Retrait' THEN 'forbidden'
                      WHEN g.statut LIKE %s AND d.useToleranceDate IS NOT NULL THEN 'withdrawing'
                      WHEN g.statut LIKE %s THEN 'authorized'
                      ELSE 'unknown'
                  END AS authorizationStatus
           FROM general g
           LEFT JOIN dates d ON d.idAct = g.idAct
           WHERE g.mostRecentAct = 1""",
        ("%Accord%", "%Accord%"),
    )
    return jsonify(cur.fetchall())


@bp.get("/phytoweb_products/search")
def search_phytoweb_products():
    """Recherche par nom commercial ou numéro d'autorisation. Query : ?q=&limit=(défaut 50)."""
    query = (request.args.get("q") or "").strip().lower()
    if not query:
        return jsonify([])
    limit = min(int(request.args.get("limit", 50)), 200)

    cur = cursor_phytoweb()
    like = f"%{query}%"
    cur.execute(
        """SELECT idAct, numAut, productName, productType, productComposition
           FROM general
           WHERE mostRecentAct = 1 AND (LOWER(productName) LIKE %s OR LOWER(numAut) LIKE %s)
           ORDER BY productName
           LIMIT %s""",
        (like, like, limit),
    )
    return jsonify(cur.fetchall())


@bp.get("/phytoweb_crops")
def get_phytoweb_crops():
    """Catalogue dédupliqué des cultures (indexCrop), pas les lignes acte×culture de `crops`."""
    cur = cursor_phytoweb()
    cur.execute("SELECT idCrop, cropName FROM indexCrop ORDER BY cropName")
    return jsonify(cur.fetchall())


@bp.get("/doseminmax")
def get_doseminmax():
    """
    Doses min/max par produit/culture/cible. Query optionnels :
    ?numAut=<numéro d'autorisation exact>, ?idAct=<idAct exact> et/ou
    ?cropName=<nom de culture exact> pour filtrer côté serveur
    (remplace previousServer/get_doses_phytoweb.php).
    """
    conditions = ["g.mostRecentAct = 1"]
    params = []

    num_aut = request.args.get("numAut")
    if num_aut:
        conditions.append("g.numAut = %s")
        params.append(num_aut)

    id_act = request.args.get("idAct")
    if id_act:
        conditions.append("g.idAct = %s")
        params.append(id_act)

    crop_name = request.args.get("cropName")
    if crop_name:
        conditions.append("c.cropName = %s")
        params.append(crop_name)

    cur = cursor_phytoweb()
    cur.execute(
        f"""SELECT g.idAct, g.numAut, g.productName, c.cropName, t.target,
                   t.minDose, t.maxDose, t.doseUnit, t.doseUnitId, t.maxApp
            FROM targets t
            JOIN crops c ON c.idCropData = t.idCropData
            JOIN general g ON g.idAct = t.idAct
            WHERE {" AND ".join(conditions)}""",
        tuple(params),
    )
    return jsonify(cur.fetchall())


@bp.get("/enemies")
def get_enemies():
    """Catalogue dédupliqué des cibles/ravageurs (indexTarget)."""
    cur = cursor_phytoweb()
    cur.execute("SELECT idTarget, targetName FROM indexTarget ORDER BY targetName")
    return jsonify(cur.fetchall())


@bp.get("/crop_authorizations")
def get_crop_authorizations():
    """
    Cultures autorisées, dose max par culture, et stades d'application (BBCH) pour un
    produit — table `crops` (1 ligne par couple acte×culture), filtrée par idAct.
    Non filtré par culture ici : le frontend recoupe côté client avec les cultures du
    draft (même pattern que /doseminmax), pour permettre de dériver à la fois
    l'avertissement "culture non autorisée" et l'avertissement BBCH depuis un seul appel.
    Query : ?idAct=<idAct exact>.
    """
    id_act = request.args.get("idAct")
    if not id_act:
        return jsonify([])
    cur = cursor_phytoweb()
    cur.execute(
        """SELECT idCropData, idCrop, idAct, cropName, cropApplicationStade,
                  cropMaxDose, cropMaxDoseUnit, cropMaxDoseUnitId, cropMaxApp
           FROM crops
           WHERE idAct = %s""",
        (id_act,),
    )
    return jsonify(cur.fetchall())
