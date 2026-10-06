"""
Helpers partagés par les 3 moteurs de calcul de traitement (surface.py, bouillie.py,
quantite.py). Voir treatment_calc/__init__.py pour le contrat d'entrée/sortie complet.
"""
from app.utils.units import resolve_and_standardize, find_unit_id_by_name


def default_parcel_surface(cur, user_id, parcel_id):
    """
    Surface par défaut d'une parcelle (utilisée quand le payload ne fournit pas de
    surfaceTreated explicite pour cette parcelle) : reprend parcelArea/parcelAreaUnitId/
    standardParcelArea de la table `parcels`.
    Retourne (area, area_unit_id, standard_area), tous None si la parcelle est introuvable.
    """
    cur.execute(
        "SELECT parcelArea, parcelAreaUnitId, standardParcelArea FROM parcels WHERE parcelId = %s AND userId = %s",
        (parcel_id, user_id),
    )
    row = cur.fetchone()
    if not row:
        return None, None, None
    return row["parcelArea"], row["parcelAreaUnitId"], row["standardParcelArea"]


def mass_or_volume_name(unit_name: str) -> str:
    """
    Réplique côté serveur l'heuristique déjà utilisée par le frontend
    (getQuantityUnitFromDoseUnit, traitement-phyto.component.ts) : une dose/quantité de
    produit se résout toujours vers l'une de ces deux unités canoniques, "kg" (produits
    solides/poudres) ou "l" (produits liquides), déduite du nom d'unité.
    """
    name = (unit_name or "").lower()
    return "kg" if "kg" in name or "g" in name else "l"


def mass_or_volume_unit_id(unit_name: str):
    """Comme mass_or_volume_name, mais retourne directement l'idUnit résolu ("kg"/"l")."""
    return find_unit_id_by_name(mass_or_volume_name(unit_name))


def dose_per_ha_unit_id(unit_name: str):
    """
    Unité de dose (par ha) correspondant à une unité de quantité de produit — utilisé en
    mode Quantité pour déduire productDoseUnitId une fois la quantité saisie convertie en
    dose. "l" -> "l/ha", "kg" -> "kg/ha".
    """
    return find_unit_id_by_name(f"{mass_or_volume_name(unit_name)}/ha")


def resolve_surface(cur, user_id, parcel_id, surface_treated, surface_unit):
    """
    Résout la surface traitée d'une parcelle : valeur/unité envoyées par le payload si
    présentes, sinon défaut = surface de la parcelle (`parcels.parcelArea`).
    Retourne (surfaceTreated, surfaceTreatedUnitId, standardSurfaceTreated).
    """
    if surface_treated is not None and surface_unit:
        unit_id, standard = resolve_and_standardize(surface_treated, surface_unit)
        return surface_treated, unit_id, standard

    area, area_unit_id, standard_area = default_parcel_surface(cur, user_id, parcel_id)
    return area, area_unit_id, standard_area


def sum_standardized_by_unit(items, value_key, unit_key):
    """
    Somme des valeurs déjà standardisées (`value_key`, ex. "standardProductQuantity"),
    regroupées par unité résultante (`unit_key`, ex. "productQuantityUnitId" — toujours
    "kg" ou "l" via mass_or_volume_unit_id). On ne peut pas sommer kg et L ensemble : si
    plusieurs unités coexistent dans une même composition, on retient le bucket dont le
    total standardisé est le plus élevé (même heuristique que l'actuel
    hasMultipleUnits/firstUnit côté frontend).
    Retourne (total, unit_id) ; (0.0, None) si `items` est vide.
    """
    totals: dict = {}
    for item in items:
        value = item.get(value_key) or 0.0
        unit_id = item.get(unit_key)
        totals[unit_id] = totals.get(unit_id, 0.0) + value

    if not totals:
        return 0.0, None

    best_unit_id = max(totals, key=totals.get)
    return totals[best_unit_id], best_unit_id
