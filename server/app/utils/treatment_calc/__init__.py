"""
Moteur de calcul des traitements phytosanitaires : un module par mode de saisie
(surface.py, bouillie.py, quantite.py), chacun implémentant la même signature compute().
Appelé depuis app/routes/phyto_treatments.py (create_treatment/update_treatment), qui
reste le seul endpoint HTTP (POST/PUT /phyto_treatments) — le dispatch par mode est
purement interne.

Principe : recalcul complet à chaque écriture (création ou modification), à partir des
seules valeurs "de base" propres à chaque mode (voir chaque module). Comme
update_treatment supprime déjà et ré-insère intégralement les lignes filles
(phytoTreatmentsParcelsCrops/phytoTreatmentsComposition, comme field_works.py le fait
pour fieldWorksParcelsCrops), recalculer tout l'état à chaque fois est plus simple et
plus sûr qu'un calcul différentiel ("si tel champ a changé, recalculer tel autre") et
produit le même résultat final.
"""
from . import surface, bouillie, quantite

_CALCULATORS = {
    "phyto_surface_treatment": surface,
    "phyto_porridge_treatment": bouillie,
    "phyto_quantity_treatment": quantite,
}


def compute(event_type, cur, user_id, treatment_data, parcels_in, composition_in):
    """
    Calcule l'ensemble des champs dérivés d'un traitement selon son mode (eventType).
    Retourne (treatment_fields: dict, parcels_out: list[dict], composition_out: list[dict])
    prêts à être insérés respectivement dans phytoTreatments, phytoTreatmentsParcelsCrops
    et phytoTreatmentsComposition.

    treatment_data : champs bruts du payload utiles au calcul (treatmentTotalQuantity*
        en mode Bouillie — ignoré dans les autres modes).
    parcels_in : liste brute payload["parcelsConcerned"] (parcelId, parcelName, cropId,
        cropName, phytowebCropName, + surfaceTreated/surfaceTreatedUnit optionnels).
    composition_in : liste brute payload["treatmentComposition"] (productId, productName,
        productNumAut, productTarget, + productDose/productDoseUnit ou
        productQuantity/productQuantityUnit selon le mode).
    """
    calculator = _CALCULATORS.get(event_type, surface)
    return calculator.compute(cur, user_id, treatment_data, parcels_in, composition_in)
