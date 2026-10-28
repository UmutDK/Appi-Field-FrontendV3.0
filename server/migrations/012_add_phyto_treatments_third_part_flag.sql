-- Base : c2544857c_appifield
-- thirdPartFlag : traitement effectué par un tiers (entrepreneur, voisin...). Quand il vaut 1,
-- les quantités de produits du traitement ne sont PAS déduites de l'inventaire de
-- l'utilisateur (ce n'est pas son stock qui a été consommé) et n'apparaissent pas dans son
-- historique d'inventaire. Le traitement reste par ailleurs un traitement normal (registre,
-- export, calculs). NOT NULL DEFAULT 0 : toutes les lignes existantes valent 0.
-- À appliquer AVANT de déployer le backend qui l'utilise (lecture dans inventory_stock.py,
-- écriture dans phyto_treatments.py).

ALTER TABLE phytoTreatments ADD COLUMN thirdPartFlag TINYINT(1) NOT NULL DEFAULT 0 AFTER effectiveness;
