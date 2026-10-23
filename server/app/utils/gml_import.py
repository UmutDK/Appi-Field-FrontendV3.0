"""
Parsing des fichiers GML PAC wallons (V1 "PARCEL" et MR14/V2 "PARCELLE_MR14") en
parcelles exploitables par POST /parcels. Remplace previousServer/gml_import.php
(qui utilisait proj4php) par pyproj pour la conversion Lambert72 (EPSG:31370) → WGS84.
"""
import xml.etree.ElementTree as ET
from pyproj import Transformer

_LAMBERT72_TO_WGS84 = Transformer.from_crs("EPSG:31370", "EPSG:4326", always_xy=True)

_COVER_TYPE_TO_CATEGORY = {
    "PRAIRIE_PERM_90_100": "Plein air",
    "TERRE_ARABLE": "Plein air",
    "PRAIRIE_TEMPORAIRE": "Plein air",
    "CULTURE_PERMANENTE": "Plein air",
    "HAIE_BDE_BOIS": "Plein air",
    "BOSQUET": "Plein air",
}

_CROP_CODE_TO_CATEGORY = {
    "610": "Plein air",
    "311": "Plein air",
    "351": "Plein air",
    "901": "Plein air",
    "3912": "Plein air",
}


class GmlImportError(Exception):
    pass


def _local_tag(elem) -> str:
    return elem.tag.split("}")[-1]


def _find_any(elem, *local_names):
    """Cherche un descendant par nom local, indépendamment du namespace GML/PAC/MR14."""
    for child in elem.iter():
        if _local_tag(child) in local_names:
            return child
    return None


def _text(elem, *local_names, default=""):
    found = _find_any(elem, *local_names)
    return found.text.strip() if found is not None and found.text else default


def _parse_pos_list(text):
    values = [float(v) for v in text.split()]
    return [(values[i], values[i + 1]) for i in range(0, len(values) - 1, 2)]


def _parse_coordinates(text):
    pairs = []
    for pair in text.strip().split():
        parts = pair.split(",")
        if len(parts) >= 2:
            pairs.append((float(parts[0]), float(parts[1])))
    return pairs


def _find_geometry_coords(parcel_elem):
    pos_list = _find_any(parcel_elem, "posList")
    if pos_list is not None and pos_list.text:
        return _parse_pos_list(pos_list.text)
    coordinates = _find_any(parcel_elem, "coordinates")
    if coordinates is not None and coordinates.text:
        return _parse_coordinates(coordinates.text)
    return []


def _polygon_area_ha(coords):
    if len(coords) < 3:
        return 0.0
    area = 0.0
    n = len(coords)
    for i in range(n):
        x1, y1 = coords[i]
        x2, y2 = coords[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return round(abs(area) / 2.0 / 10000.0, 2)


def _centroid(coords):
    n = len(coords)
    return sum(c[0] for c in coords) / n, sum(c[1] for c in coords) / n


def _lambert72_to_wgs84(x, y):
    lon, lat = _LAMBERT72_TO_WGS84.transform(x, y)
    return lat, lon


def _detect_format(root) -> str | None:
    for elem in root.iter():
        tag = _local_tag(elem)
        if tag == "PARCEL":
            return "v1"
        if tag == "PARCELLE_MR14":
            return "v2"
    return None


def _convert_v1_parcel(parcel_elem):
    coords = _find_geometry_coords(parcel_elem)
    if not coords:
        return None

    area_ha = _polygon_area_ha(coords)
    cx, cy = _centroid(coords)
    lat, lon = _lambert72_to_wgs84(cx, cy)
    polygon = [_lambert72_to_wgs84(x, y) for x, y in coords]

    prc_id = _text(parcel_elem, "PRC_ID", default="Parcelle")
    prc_nmr = parcel_elem.get("PRC_NMR", "")
    clean_id = prc_id[len("Parcelle_"):] if prc_id.lower().startswith("parcelle_") else prc_id
    name = f"Parcelle_{clean_id}" + (f"_{prc_nmr}" if prc_nmr else "")

    # Adaptation temporaire (09/09/2026) : si un element/attribut PRC_NAME est
    # present sur la parcelle, on l'utilise tel quel comme parcelName a la place
    # du nom recompose ci-dessus. A retirer/reevaluer une fois le besoin clarifie.
    # PRC_NAME est un element enfant comme PRC_ID (pas un attribut comme
    # PRC_NMR), d'ou l'utilisation de _text avec repli sur l'attribut.
    prc_name = _text(parcel_elem, "PRC_NAME") or parcel_elem.get("PRC_NAME", "")
    if prc_name:
        name = prc_name

    cover_type = _text(parcel_elem, "TYPE_COUVERTURE")

    return {
        "parcelName": name,
        "parcelArea": area_ha,
        "parcelAreaUnit": "ha",
        "parcelCategory": _COVER_TYPE_TO_CATEGORY.get(cover_type, "Plein air"),
        "parcelAddress": "Parcelle GML importée",
        "latitude": round(lat, 7),
        "longitude": round(lon, 7),
        "polygon": [[round(p[0], 7), round(p[1], 7)] for p in polygon],
        "recordType": "gml_import",
    }


def _convert_v2_parcel(parcel_elem):
    coords = _find_geometry_coords(parcel_elem)
    if not coords:
        return None

    area_ha = _polygon_area_ha(coords)
    cx, cy = _centroid(coords)

    polygon_elem = _find_any(parcel_elem, "Polygon")
    srs_name = polygon_elem.get("srsName", "") if polygon_elem is not None else ""
    if "31370" in srs_name:
        lat, lon = _lambert72_to_wgs84(cx, cy)
        polygon = [_lambert72_to_wgs84(x, y) for x, y in coords]
    else:
        lat, lon = cy, cx
        polygon = coords

    parcel_number = _text(parcel_elem, "PARCELNUMBER")
    parcel_name = _text(parcel_elem, "PARCELNAME") or f"Parcelle_{parcel_number}"
    main_crop_code = _text(parcel_elem, "MAINCROPCODE")
    main_crop_name = _text(parcel_elem, "MAINCROPNAME")

    category = _CROP_CODE_TO_CATEGORY.get(main_crop_code)
    if not category:
        category = "Prairie permanente" if "prairie" in main_crop_name.lower() else "Plein air"

    return {
        "parcelName": parcel_name,
        "parcelArea": area_ha,
        "parcelAreaUnit": "ha",
        "parcelCategory": category,
        "parcelAddress": "Parcelle GML V2 importée",
        "latitude": round(lat, 7),
        "longitude": round(lon, 7),
        "polygon": [[round(p[0], 7), round(p[1], 7)] for p in polygon],
        "recordType": "gml_import",
    }


def parse_gml_to_parcels(gml_bytes: bytes) -> list[dict]:
    """
    Parse un fichier GML PAC (V1) ou MR14 (V2) et retourne une liste de parcelles
    au format attendu par POST /parcels (parcelName, parcelArea, parcelAreaUnit,
    parcelCategory, parcelAddress, latitude, longitude, polygon, recordType).
    Lève GmlImportError si le fichier est invalide ou ne contient aucune parcelle exploitable.
    """
    try:
        root = ET.fromstring(gml_bytes)
    except ET.ParseError as e:
        raise GmlImportError(f"Fichier GML invalide : {e}")

    fmt = _detect_format(root)
    if fmt is None:
        raise GmlImportError("Format GML non reconnu (ni PAC V1, ni MR14 V2)")

    convert = _convert_v1_parcel if fmt == "v1" else _convert_v2_parcel
    tag = "PARCEL" if fmt == "v1" else "PARCELLE_MR14"

    parcels = []
    for elem in root.iter():
        if _local_tag(elem) == tag:
            parcel = convert(elem)
            if parcel:
                parcels.append(parcel)

    if not parcels:
        raise GmlImportError("Aucune parcelle exploitable trouvée dans le fichier GML")

    return parcels
