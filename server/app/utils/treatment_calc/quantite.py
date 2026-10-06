"""
Mode Quantité : l'utilisateur fixe la surface traitée par parcelle (défaut = surface de
la parcelle, comme en mode Surface) et la quantité totale de chaque produit (au lieu
d'une dose). La dose par ha est déduite, puis la répartition par parcelle suit la même
logique que le mode Surface.
"""
from app.utils.units import resolve_and_standardize
from .common import resolve_surface, dose_per_ha_unit_id, mass_or_volume_unit_id, sum_standardized_by_unit


def compute(cur, user_id, treatment_data, parcels_in, composition_in):
    # 1. Surface par parcelle, puis surface totale du traitement (identique au mode Surface)
    parcels_out = []
    total_standard_surface = 0.0
    for p in parcels_in:
        surface, surface_unit_id, standard_surface = resolve_surface(
            cur, user_id, p.get("parcelId"), p.get("surfaceTreated"), p.get("surfaceTreatedUnit")
        )
        standard_surface = standard_surface or 0.0
        total_standard_surface += standard_surface
        parcels_out.append({
            **p,
            "surfaceTreated": surface,
            "surfaceTreatedUnitId": surface_unit_id,
            "standardSurfaceTreated": standard_surface,
        })

    # 2. Quantité saisie -> dose déduite (quantité standardisée / surface totale standardisée)
    composition_out = []
    for c in composition_in:
        quantity = c.get("productQuantity")
        quantity_unit_name = c.get("productQuantityUnit")
        quantity_unit_id, standard_quantity = resolve_and_standardize(quantity, quantity_unit_name)
        standard_quantity = standard_quantity or 0.0
        standard_dose = (standard_quantity / total_standard_surface) if total_standard_surface else 0.0
        composition_out.append({
            **c,
            "productQuantity": quantity,
            "productQuantityUnitId": mass_or_volume_unit_id(quantity_unit_name),
            "standardProductQuantity": standard_quantity,
            "productDose": standard_dose,
            "productDoseUnitId": dose_per_ha_unit_id(quantity_unit_name),
            "standardProductDose": standard_dose,
        })

    # 3. Quantité de produit par parcelle = somme(dose_standard * surface_standard_de_cette_parcelle)
    for p in parcels_out:
        contributions = [
            {"v": c["standardProductDose"] * p["standardSurfaceTreated"], "u": c["productQuantityUnitId"]}
            for c in composition_out
        ]
        total, unit_id = sum_standardized_by_unit(contributions, "v", "u")
        p["treatmentQuantity"] = total
        p["treatmentQuantityUnitId"] = unit_id
        p["standardTreatmentQuantity"] = total

    # Totaux du traitement = somme des quantités de produit (regroupées par unité kg/l)
    total_quantity, total_unit_id = sum_standardized_by_unit(
        composition_out, "standardProductQuantity", "productQuantityUnitId"
    )

    treatment_fields = {
        "surfaceTreated": total_standard_surface,
        "standardSurfaceTreated": total_standard_surface,
        "treatmentTotalQuantity": total_quantity,
        "treatmentTotalQuantityUnitId": total_unit_id,
        "standardTreatmentTotalQuantity": total_quantity,
        "treatmentTotalQuantityUsed": total_quantity,
        "treatmentTotalQuantityUsedUnitId": total_unit_id,
        "standardTreatmentTotalQuantityUsed": total_quantity,
    }
    return treatment_fields, parcels_out, composition_out
