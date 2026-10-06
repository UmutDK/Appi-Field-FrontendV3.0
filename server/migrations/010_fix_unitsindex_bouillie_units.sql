-- Base : c2544857c_corderPhytoweb
-- ⚠️ Exceptionnellement une écriture sur cette base (normalement lecture seule côté API,
-- alimentée par le pipeline ETL PhytowebCorder) : correction d'un bug de données avéré
-- dans le référentiel unitsIndex, condition préalable au nouveau moteur de calcul par
-- mode (Surface/Bouillie/Quantité) qui s'appuie sur normalisationFactor.
--
-- 4 unités existent en double (avec/sans espace autour du nombre, casse différente sur L)
-- avec des facteurs incohérents entre les deux variantes — l'une des deux est fausse.
-- Facteurs corrects dérivés des ancrages non ambigus du référentiel : l/ha=1.0, kg/ha=1.0,
-- l/100 l=0.01 (cette dernière n'a pas de doublon conflictuel, donc fiable).
--   kg/100L : 100.0 -> 0.01     (doit suivre l/100L=0.01, kg et l traités à la même échelle)
--   g/100 l : 0.001 -> 0.00001  (g = 0.001 kg, donc g/100L = 0.01 * 0.001)
--   ml/100 l: 0.0001 -> 0.00001 (ml = 0.001 l, donc ml/100L = 0.01 * 0.001)
--   l/10l   : 10.0   -> 0.1     (doit suivre l/100l=0.01 -> l/10l = 0.01*10 = 0.1)
-- Ces chaînes exactes (casse/espacement) sont celles envoyées par le frontend
-- (traitement-phyto.component.ts::bouillieUnitOptions), donc réellement utilisées par
-- find_unit_id_by_name (comparaison exacte après lower(), sans normalisation des espaces).

UPDATE unitsIndex SET normalisationFactor = 0.01    WHERE unitName = 'kg/100L';
UPDATE unitsIndex SET normalisationFactor = 0.00001 WHERE unitName = 'g/100 l';
UPDATE unitsIndex SET normalisationFactor = 0.00001 WHERE unitName = 'ml/100 l';
UPDATE unitsIndex SET normalisationFactor = 0.1     WHERE unitName = 'l/10l';

-- L'unité "g" seule (grammes) n'existe pas du tout dans le référentiel, bloquant la
-- standardisation en mode Quantité pour tout produit dosé en grammes. Facteur cohérent
-- avec g/ha=0.001 (vs kg/ha=1.0).
INSERT INTO unitsIndex (idUnit, unitName, normalisationFactor)
SELECT CONCAT('unit_', UUID()), 'g', 0.001
WHERE NOT EXISTS (SELECT 1 FROM unitsIndex WHERE unitName = 'g');
