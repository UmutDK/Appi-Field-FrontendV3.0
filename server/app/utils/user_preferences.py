"""
Lecture des préférences d'encodage (table `userPreferences`, migration 014), partagée par
/user_preferences et l'endpoint d'avertissements des traitements phyto.
Un utilisateur sans ligne (compte créé après la migration, jamais enregistré ses
préférences) reçoit les valeurs par défaut — la ligne n'est créée qu'à son premier PUT,
pour qu'une simple lecture n'écrive jamais en base.
"""
from app.db import cursor_appifield

BOOL_FIELDS = ("erRiWarningFlag", "spe8HourWarningFlag", "bbchWarningFlag")

DEFAULTS = {
    "erRiWarningFlag": False,
    "spe8HourWarningFlag": True,
    "bbchWarningFlag": True,
    "defaultTreatmentType": "surface",
}

# defaultTreatmentType -> eventType du traitement (mode d'encodage Surface/Bouillie/Quantité)
TREATMENT_TYPE_TO_EVENT_TYPE = {
    "surface": "phyto_surface_treatment",
    "porridge": "phyto_porridge_treatment",
    "quantity": "phyto_quantity_treatment",
}


def get_user_preferences(user_id: str) -> dict:
    cur = cursor_appifield()
    cur.execute(
        f"SELECT {', '.join(BOOL_FIELDS)}, defaultTreatmentType FROM userPreferences WHERE idUser = %s",
        (user_id,),
    )
    row = cur.fetchone()
    prefs = dict(DEFAULTS)
    if row:
        prefs.update({field: bool(row[field]) for field in BOOL_FIELDS})
        if row["defaultTreatmentType"] in TREATMENT_TYPE_TO_EVENT_TYPE:
            prefs["defaultTreatmentType"] = row["defaultTreatmentType"]
    prefs["defaultEventType"] = TREATMENT_TYPE_TO_EVENT_TYPE[prefs["defaultTreatmentType"]]
    return prefs
