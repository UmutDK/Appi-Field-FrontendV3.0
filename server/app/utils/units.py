"""
Utilitaires pour la gestion des unités.
La table unitsIndex est chargée en mémoire au démarrage depuis c2544857c_corderPhytoweb.
"""
from app.db import cursor_phytoweb

# Cache en mémoire : liste de tuples (idUnit, unitName, normalisationFactor)
_units_cache: list = []


def _load_units():
    global _units_cache
    if not _units_cache:
        cur = cursor_phytoweb(dictionary=False)
        cur.execute("SELECT idUnit, unitName, normalisationFactor FROM unitsIndex")
        _units_cache = cur.fetchall()


def find_unit_id_by_name(unit_name: str):
    """Retourne l'idUnit correspondant au nom d'unité, ou None si introuvable."""
    _load_units()
    name_lower = unit_name.lower()
    for row in _units_cache:
        if row[1].lower() == name_lower:
            return row[0]
    return None


def find_unit_name_by_id(unit_id):
    """Retourne le unitName correspondant à un idUnit, ou l'id tel quel si introuvable (ex. déjà un nom brut)."""
    if unit_id is None:
        return ""
    _load_units()
    for row in _units_cache:
        if str(row[0]) == str(unit_id):
            return row[1]
    return str(unit_id)


def find_unit_conversion_factor_by_name(unit_name: str):
    """Retourne le normalisationFactor correspondant au nom d'unité, ou None si introuvable."""
    _load_units()
    name_lower = unit_name.lower()
    for row in _units_cache:
        if row[1].lower() == name_lower:
            return row[2]
    return None


def reload_units():
    """Force le rechargement du cache depuis la base (utile après une mise à jour de unitsIndex)."""
    global _units_cache
    _units_cache = []
    _load_units()


def resolve_and_standardize(value, unit_name):
    """
    Résout un nom d'unité en idUnit et calcule la valeur standardisée.
    Retourne (unit_id, standardized_value). Si l'unité est introuvable ou que
    value est None, unit_id vaut unit_name tel quel et standardized_value vaut value.
    """
    if not unit_name:
        return unit_name, value
    unit_id = find_unit_id_by_name(unit_name)
    factor = find_unit_conversion_factor_by_name(unit_name)
    if unit_id is None or factor is None or value is None:
        return unit_name, value
    try:
        # Le client envoie parfois la quantité/dose sous forme de chaîne (ex. "12.5") ;
        # value * factor lève TypeError sur un str, donc on caste explicitement.
        numeric_value = float(value)
    except (TypeError, ValueError):
        return unit_name, value
    return unit_id, numeric_value * factor
