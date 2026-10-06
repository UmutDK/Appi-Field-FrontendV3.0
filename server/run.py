from app import create_app
import os
from dotenv import load_dotenv

load_dotenv()
# Surcharge locale non versionnée (voir .gitignore) : permet d'activer READONLY_MODE
# ou d'autres réglages propres à sa machine sans toucher au .env partagé/commité.
load_dotenv(os.path.join(os.path.dirname(__file__), ".env.local"), override=True)

app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "False").lower() == "true"
    # use_reloader=False : cet environnement Python partagé a des centaines de paquets
    # sans rapport avec ce projet (numpy, sklearn, openai, keras...) importés on ne sait
    # trop comment ; le rechargeur les surveille tous et redémarre en boucle dès que l'un
    # de leurs fichiers voit son horodatage changer, tuant les requêtes en cours (erreurs
    # "CORS"/"Unknown Error" côté navigateur alors qu'il n'y a pas de vrai souci CORS).
    # Redémarrer manuellement le serveur après une modification du code reste nécessaire.
    app.run(host="0.0.0.0", port=port, debug=debug, use_reloader=False)
