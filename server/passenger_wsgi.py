import os
import sys

# Point d'entrée Passenger ("Setup Python App" de cPanel) : Passenger importe ce fichier
# et sert l'objet WSGI `application`. run.py charge .env puis crée l'app Flask.
sys.path.insert(0, os.path.dirname(__file__))

from run import app as application
