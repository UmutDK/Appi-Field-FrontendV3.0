"""
Exports PDF/Excel du registre et de l'inventaire.
Remplace previousServer/export_clean_new.php, export_pdf.php, export_inventaire.php.
"""
from flask import Blueprint, request, send_file
from app.auth import require_auth
from app.utils.exports import build_registre_excel, build_registre_pdf, build_inventaire_excel

bp = Blueprint("exports", __name__, url_prefix="/exports")

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@bp.post("/registre")
@require_auth
def export_registre(user_id):
    """
    Body : { filters?: { years?: string[], cropNames?: string[],
                          archiveStatus?: 'all'|'archived'|'not-archived', parcels?: string[] } }
    Query param : ?format=excel|pdf (défaut excel)
    """
    data = request.get_json(silent=True) or {}
    filters = data.get("filters") or {}

    if request.args.get("format") == "pdf":
        buffer = build_registre_pdf(user_id, filters)
        return send_file(buffer, mimetype="application/pdf", as_attachment=True, download_name="registre.pdf")

    buffer = build_registre_excel(user_id, filters)
    return send_file(buffer, mimetype=_XLSX_MIME, as_attachment=True, download_name="registre.xlsx")


@bp.post("/inventaire")
@require_auth
def export_inventaire(user_id):
    buffer = build_inventaire_excel(user_id)
    return send_file(buffer, mimetype=_XLSX_MIME, as_attachment=True, download_name="inventaire.xlsx")
