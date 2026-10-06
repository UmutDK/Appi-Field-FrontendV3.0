<?php
/**
 * Fonctions utilitaires pour les traitements phytosanitaires
 * Calculs, normalisations, conversions d'unités
 */

/**
 * Détermine l'unité de quantité (L ou Kg) à partir de l'unité de dose
 * Règle: kg, g (sauf ml) → Kg, sinon → L
 * 
 * Unités supportées:
 * - Surface: L/ha, ml/ha, kg/ha, g/ha, L/a, ml/a, kg/a, g/a, L/m2, ml/m2, kg/m2, g/m2
 * - Bouillie: L/100L, ml/100L, kg/100L, g/100L, L/10L, ml/10L, kg/10L, g/10L, ml/L, g/L
 * - Absolu: L, Kg
 */
function getQuantityUnitFromDoseUnit($doseUnit) {
    $unit = strtolower(trim($doseUnit ?? ''));
    
    // 1. Contient 'kg' → Kg
    if (strpos($unit, 'kg') !== false) {
        return 'Kg';
    }
    
    // 2. Commence par 'g/' ou 'g ' (gramme par...) → Kg
    if (strpos($unit, 'g/') === 0 || strpos($unit, 'g ') === 0) {
        return 'Kg';
    }
    
    // 3. Contient '/g' (par gramme) → Kg
    if (strpos($unit, '/g') !== false) {
        return 'Kg';
    }
    
    // 4. Exactement 'g' (gramme seul) → Kg
    if ($unit === 'g') {
        return 'Kg';
    }
    
    // Tout le reste (L, ml, L/ha, ml/ha, L/100L, ml/100L, etc.) → L
    return 'L';
}

function convertTreatmentToInventoryEventData($treatmentData) {
    $eventData = [
        'event_id'       => $treatmentData['event_id'],
        'event_date'     => $treatmentData['date'] ?? $treatmentData['event_date'] ?? date('Y-m-d'),
        'event_crop'     => $treatmentData['target'] ?? $treatmentData['ciblee'] ?? '',
        'event_type'     => 'treatment',
        'exploitation_id' => $treatmentData['exploitation_id'] ?? 'default',
        'products'       => []
    ];

    $composition = $treatmentData['treatment_composition'] ?? [];
    // backward-compat: unwrap double-wrapped structure
    if (isset($composition[0]) && is_array($composition[0]) && isset($composition[0][0])) {
        $composition = $composition[0];
    }
    foreach ($composition as $component) {
        if (!is_array($component)) continue;
        $quantityUsedUnit = $component['component_quantity_unity'] ?? 'L';
        $eventData['products'][] = [
            'product_id'       => $component['component_id'] ?? '',
            'product_name'     => $component['component_name'] ?? '',
            'product_numaut'   => $component['component_numaut'] ?? '',
            'quantity_used'    => floatval($component['component_quantity'] ?? 0),
            'quantity_used_unit' => $quantityUsedUnit
        ];
    }

    return $eventData;
}

function calculateStandardTotalSurfaceTreated($treatmentData) {
    $totalStandardSurface = 0;

    if (isset($treatmentData['parcels_concerned']) &&
        is_array($treatmentData['parcels_concerned']) &&
        !empty($treatmentData['parcels_concerned'])) {

        $parcelsData = $treatmentData['parcels_concerned'];
        // backward-compat: unwrap double-wrapped structure
        if (isset($parcelsData[0]) && is_array($parcelsData[0]) && isset($parcelsData[0][0])) {
            $parcelsData = $parcelsData[0];
        }
        if (is_array($parcelsData) && !empty($parcelsData)) {
            foreach ($parcelsData as $parcel) {
                if (isset($parcel['standard_surface_treated'])) {
                    $totalStandardSurface += floatval($parcel['standard_surface_treated']);
                }
            }
        }
    }

    return $totalStandardSurface;
}

function ensureStandardTotalSurfaceTreated(&$treatmentData) {
    $oldValue = floatval($treatmentData['standard_total_surface_treated'] ?? 0);
    $newValue = calculateStandardTotalSurfaceTreated($treatmentData);
    
    if (abs($newValue - $oldValue) > 0.01) {
        $treatmentData['standard_total_surface_treated'] = $newValue;
        $treatmentData['surface_calculated_at'] = date('c');
        return true;
    }
    
    return false;
}

function getTreatmentVolumeUnit($treatmentData) {
    if (!isset($treatmentData['treatment_composition']) || !is_array($treatmentData['treatment_composition'])) {
        return 'L';
    }

    $compositionData = $treatmentData['treatment_composition'];
    // backward-compat: unwrap double-wrapped structure
    if (isset($compositionData[0]) && is_array($compositionData[0]) && isset($compositionData[0][0])) {
        $compositionData = $compositionData[0];
    }
    if (!is_array($compositionData)) {
        return 'L';
    }

    foreach ($compositionData as $component) {
        if (!is_array($component)) continue;
        $doseUnit = strtolower($component['component_dose_unit'] ?? '');
        if (getQuantityUnitFromDoseUnit($doseUnit) === 'Kg') {
            return 'Kg';
        }
    }

    return 'L';
}

function calculateTreatmentVolumeApplied(&$treatmentData) {
    $modificationsCount = 0;
    
    if (!isset($treatmentData['parcels_concerned']) || !is_array($treatmentData['parcels_concerned'])) {
        return $modificationsCount;
    }
    
    $treatmentType = $treatmentData['type'] ?? '';
    $isBouillieMode = (strpos($treatmentType, 'bouillie') !== false) || 
                      (strpos($treatmentType, 'porridge') !== false);
    
    if ($isBouillieMode) {
        $treatmentUnit = 'L'; // En mode bouillie, on considère que l'unité est toujours en L (volume de bouillie)
    }
    else {
        // En mode surface, on peut avoir L ou Kg selon les composants
        $treatmentUnit = getTreatmentVolumeUnit($treatmentData);
    }

    $totalVolumeUsed = floatval($treatmentData['treatment_total_quantity_used'] ?? 0);
    $totalStandardSurface = floatval($treatmentData['standard_total_surface_treated'] ?? 0);
    
    if ($totalStandardSurface <= 0) {
        return $modificationsCount;
    }
    
    if ($isBouillieMode) {
        $parcelsData = &$treatmentData['parcels_concerned'];
        // backward-compat: unwrap double-wrapped
        if (isset($parcelsData[0]) && is_array($parcelsData[0]) && isset($parcelsData[0][0])) {
            $treatmentData['parcels_concerned'] = $parcelsData[0];
            $parcelsData = &$treatmentData['parcels_concerned'];
        }
        if (is_array($parcelsData)) {
            $totalManualVolume = 0;
            $parcelsWithVolumes = 0;
            
            foreach ($parcelsData as $parcel) {
                $currentVolume = floatval($parcel['treatment_volume_applied'] ?? 0);
                if ($currentVolume > 0) {
                    $totalManualVolume += $currentVolume;
                    $parcelsWithVolumes++;
                }
            }
            
            //  NOUVEAU SYSTÈME : En mode bouillie, TOUJOURS préserver les volumes manuels
            // Si au moins une parcelle a un volume (manuel), on ne recalcule RIEN
            // On fait juste confiance au draft local qui a été validé côté frontend
            if ($totalManualVolume > 0) {
                // Juste s'assurer que les unités sont cohérentes
                foreach ($parcelsData as &$parcel) {
                    $parcel['treatment_volume_applied_unit'] = $treatmentUnit;
                }
                
                //  CORRECTION : Mettre à jour treatment_total_quantity_used avec la somme réelle des volumes
                $oldTotalUsed = floatval($treatmentData['treatment_total_quantity_used'] ?? 0);
                $newTotalUsed = round($totalManualVolume, 3);
                
                if (abs($newTotalUsed - $oldTotalUsed) > 0.01) {
                    $treatmentData['treatment_total_quantity_used'] = $newTotalUsed;
                    $modificationsCount++; // Compter comme modification pour tracking
                }
                
                return $modificationsCount; //  Volumes manuels préservés, total recalculé
            } else {
                // Aucun volume manuel : cas initial, on peut recalculer
                if ($totalVolumeUsed <= 0) {
                    return $modificationsCount;
                }
            }
        }
    } else {
        if ($totalVolumeUsed <= 0) {
            return $modificationsCount;
        }
    }
    
    $parcelsData = &$treatmentData['parcels_concerned'];
    // backward-compat: unwrap double-wrapped
    if (isset($parcelsData[0]) && is_array($parcelsData[0]) && isset($parcelsData[0][0])) {
        $treatmentData['parcels_concerned'] = $parcelsData[0];
        $parcelsData = &$treatmentData['parcels_concerned'];
    }
    if (is_array($parcelsData)) {
        foreach ($parcelsData as &$parcel) {
            $parcelSurface = floatval($parcel['standard_surface_treated'] ?? 0);
            if ($parcelSurface > 0) {
                $calculatedVolume = ($parcelSurface / $totalStandardSurface) * $totalVolumeUsed;
                $parcel['treatment_volume_applied'] = round($calculatedVolume, 3);
                $modificationsCount++;
            }

            $parcel['treatment_volume_applied_unit'] = $treatmentUnit;
        }
    }
    
    return $modificationsCount;
}

function calculateComponentQuantities(&$treatmentData) {
    $modificationsCount = 0;

    if (!isset($treatmentData['treatment_composition']) || !is_array($treatmentData['treatment_composition'])) {
        return $modificationsCount;
    }

    // backward-compat: unwrap double-wrapped treatment_composition
    if (isset($treatmentData['treatment_composition'][0]) &&
        is_array($treatmentData['treatment_composition'][0]) &&
        isset($treatmentData['treatment_composition'][0][0])) {
        $treatmentData['treatment_composition'] = $treatmentData['treatment_composition'][0];
    }

    $treatmentType = $treatmentData['type'] ?? '';
    $isBouillieMode = (strpos($treatmentType, 'bouillie') !== false) ||
                      (strpos($treatmentType, 'porridge') !== false) ||
                      (isset($treatmentData['treatment_total_quantity_used']) &&
                       isset($treatmentData['treatment_total_quantity']) &&
                       !empty($treatmentData['treatment_total_quantity']) &&
                       floatval($treatmentData['treatment_total_quantity_used']) > 0 &&
                       floatval($treatmentData['treatment_total_quantity']) > 0);

    if ($isBouillieMode) {
        $totalVolumeUsed = floatval($treatmentData['treatment_total_quantity_used'] ?? 0);

        if ($totalVolumeUsed > 0) {
            $compositionData = &$treatmentData['treatment_composition'];
            if (is_array($compositionData)) {
                foreach ($compositionData as &$component) {
                    if (!is_array($component)) continue;
                    $oldQuantity = floatval($component['component_quantity'] ?? 0);

                    $componentDose = floatval($component['standard_component_dose'] ?? $component['component_dose'] ?? 0);
                    if ($componentDose > 0) {
                        $newQuantity = round(($componentDose / 100) * $totalVolumeUsed, 3);
                        if (abs($newQuantity - $oldQuantity) > 0.001 || $component['component_quantity'] === null) {
                            $component['component_quantity'] = $newQuantity;
                            $modificationsCount++;
                        }
                    } else {
                        if ($component['component_quantity'] === null) {
                            $component['component_quantity'] = 0;
                            $modificationsCount++;
                        }
                    }

                    $doseUnit = strtolower($component['component_dose_unit'] ?? '');
                    $component['component_quantity_unity'] = getQuantityUnitFromDoseUnit($doseUnit);
                }
            }
        }

        return $modificationsCount;
    }

    $totalStandardSurface = floatval($treatmentData['standard_total_surface_treated'] ?? 0);

    $compositionData = &$treatmentData['treatment_composition'];
    if (is_array($compositionData)) {
        foreach ($compositionData as &$component) {
            if (!is_array($component)) continue;
            $oldQuantity = floatval($component['component_quantity'] ?? 0);
            $doseUnit = $component['component_dose_unit'] ?? '';

            // Unités de quantité totale (L ou Kg) - Recalculer les DOSES, pas les quantités
            if ($doseUnit === 'L' || $doseUnit === 'Kg') {
                // La quantité est fixe (saisie par l'utilisateur), on recalcule la dose
                if ($totalStandardSurface > 0 && $oldQuantity > 0) {
                    $newDose = round($oldQuantity / $totalStandardSurface, 6);
                    $component['component_dose'] = $newDose;
                    $component['standard_component_dose'] = $newDose;
                }
                // Ne pas modifier component_quantity
                $component['component_quantity_unity'] = getQuantityUnitFromDoseUnit($doseUnit);
                continue;
            }

            // Comportement normal pour les autres unités : recalculer la quantité
            if ($totalStandardSurface <= 0) {
                $newQuantity = 0;
            } else {
                $componentDose = floatval($component['standard_component_dose'] ?? $component['component_dose'] ?? 0);
                if ($componentDose > 0) {
                    $calculatedQuantity = $componentDose * $totalStandardSurface;
                    $newQuantity = round($calculatedQuantity, 2);
                } else {
                    $newQuantity = 0;
                }
            }
            
            if (abs($newQuantity - $oldQuantity) > 0.01) {
                $component['component_quantity'] = $newQuantity;
                $modificationsCount++;
            }
            
            $component['component_quantity_unity'] = getQuantityUnitFromDoseUnit($doseUnit);
        }
    }
    
    return $modificationsCount;
}

function recalculateAfterDistributionUpdate(&$treatmentData) {
    $changes = [];
    
    normalizePhytoTreatmentStructure($treatmentData);
    $changes[] = 'Structure normalisée avec conversion d\'unités';
    
    $oldTotal = floatval($treatmentData['standard_total_surface_treated'] ?? 0);
    $newTotal = calculateStandardTotalSurfaceTreated($treatmentData);
    
    if (abs($newTotal - $oldTotal) > 0.0001) {
        $treatmentData['standard_total_surface_treated'] = $newTotal;
        $changes[] = "standard_total_surface_treated: {$oldTotal} → {$newTotal} ha";
    }
    
    $volumeChanges = calculateTreatmentVolumeApplied($treatmentData);
    if ($volumeChanges > 0) {
        $changes[] = "treatment_volume_applied recalculé pour {$volumeChanges} parcelles";
    }
    
    $quantityChanges = calculateComponentQuantities($treatmentData);
    if ($quantityChanges > 0) {
        $changes[] = "component_quantity recalculé pour {$quantityChanges} produits";
    }
    
    if (!empty($changes)) {
        $treatmentData['distribution_recalculated_at'] = date('c');
        $treatmentData['frontend_refresh_key'] = time() . '.' . uniqid('', true);
    }
    
    return $changes;
}

function convertSurfaceToHectares($surface, $unit) {
    $surface = floatval($surface);
    
    if ($surface <= 0) {
        return 0;
    }
    
    $unit = strtolower(trim($unit ?? 'ha'));
    
    switch ($unit) {
        case 'ha':
        case 'hectare':
        case 'hectares':
            return $surface;
        case 'a':
        case 'are':
        case 'ares':
            return round($surface / 100, 4);
        case 'm2':
        case 'm²':
        case 'meter2':
        case 'square_meter':
        case 'mètre carré':
        case 'metres_carres':
            return round($surface / 10000, 4);
        default:
            return $surface;
    }
}

function normalizePhytoTreatmentStructure(&$treatmentData) {
    if (!is_array($treatmentData)) {
        return;
    }
    
    // Conversions legacy → new field names
    if (isset($treatmentData['treatment_date']) && !isset($treatmentData['date'])) {
        $treatmentData['date'] = $treatmentData['treatment_date'];
        unset($treatmentData['treatment_date']);
    }
    if (isset($treatmentData['event_date']) && !isset($treatmentData['date'])) {
        $treatmentData['date'] = $treatmentData['event_date'];
        unset($treatmentData['event_date']);
    }

    if (isset($treatmentData['treatment_type']) && !isset($treatmentData['type'])) {
        $treatmentData['type'] = $treatmentData['treatment_type'];
        unset($treatmentData['treatment_type']);
    }

    // ciblee / remarks → new canonical names
    if (isset($treatmentData['ciblee']) && !isset($treatmentData['target'])) {
        $treatmentData['target'] = $treatmentData['ciblee'];
        unset($treatmentData['ciblee']);
    }
    if (isset($treatmentData['remarque']) && !isset($treatmentData['remark'])) {
        $treatmentData['remark'] = $treatmentData['remarque'];
        unset($treatmentData['remarque']);
    }
    if (isset($treatmentData['remarks']) && !isset($treatmentData['remark'])) {
        $treatmentData['remark'] = $treatmentData['remarks'];
        unset($treatmentData['remarks']);
    }
    if (isset($treatmentData['effectuerNottoyage']) && !isset($treatmentData['clean_flag'])) {
        $treatmentData['clean_flag'] = $treatmentData['effectuerNottoyage'];
        unset($treatmentData['effectuerNottoyage']);
    }
    if (isset($treatmentData['cleaning_performed']) && !isset($treatmentData['clean_flag'])) {
        $treatmentData['clean_flag'] = $treatmentData['cleaning_performed'];
        unset($treatmentData['cleaning_performed']);
    }
    if (isset($treatmentData['traitementLocal']) && !isset($treatmentData['localized_treatment'])) {
        $treatmentData['localized_treatment'] = $treatmentData['traitementLocal'];
        unset($treatmentData['traitementLocal']);
    }
    if (isset($treatmentData['local_treatment']) && !isset($treatmentData['localized_treatment'])) {
        $treatmentData['localized_treatment'] = $treatmentData['local_treatment'];
        unset($treatmentData['local_treatment']);
    }
    if (isset($treatmentData['operator_pl']) && !isset($treatmentData['operator_phytolicence'])) {
        $treatmentData['operator_phytolicence'] = $treatmentData['operator_pl'];
        unset($treatmentData['operator_pl']);
    }
    if (isset($treatmentData['BaseDecision']) && !isset($treatmentData['decision_base'])) {
        $treatmentData['decision_base'] = $treatmentData['BaseDecision'];
        unset($treatmentData['BaseDecision']);
    }
    if (isset($treatmentData['Efficacite']) && !isset($treatmentData['effectiveness'])) {
        $treatmentData['effectiveness'] = $treatmentData['Efficacite'];
        unset($treatmentData['Efficacite']);
    }

    if (isset($treatmentData['bbch_stage']) && !isset($treatmentData['bbch'])) {
        $treatmentData['bbch'] = $treatmentData['bbch_stage'];
        unset($treatmentData['bbch_stage']);
    }

    if (isset($treatmentData['total_quantity_used']) && !isset($treatmentData['treatment_total_quantity_used'])) {
        $treatmentData['treatment_total_quantity_used'] = $treatmentData['total_quantity_used'];
        unset($treatmentData['total_quantity_used']);
    }

    if (isset($treatmentData['total_surface_treated']) && !isset($treatmentData['standard_total_surface_treated'])) {
        $treatmentData['standard_total_surface_treated'] = $treatmentData['total_surface_treated'];
        unset($treatmentData['total_surface_treated']);
    }

    if (isset($treatmentData['parcels']) && !isset($treatmentData['parcels_concerned'])) {
        $treatmentData['parcels_concerned'] = $treatmentData['parcels'];
        unset($treatmentData['parcels']);
    }

    if (isset($treatmentData['treatment_components']) && !isset($treatmentData['treatment_composition'])) {
        $treatmentData['treatment_composition'] = $treatmentData['treatment_components'];
        unset($treatmentData['treatment_components']);
    }

    // Flatten double-wrapped parcels_concerned [[...]] → [...]
    if (isset($treatmentData['parcels_concerned'][0]) &&
        is_array($treatmentData['parcels_concerned'][0]) &&
        isset($treatmentData['parcels_concerned'][0][0])) {
        $treatmentData['parcels_concerned'] = $treatmentData['parcels_concerned'][0];
    }
    // Flatten double-wrapped treatment_composition [[...]] → [...]
    if (isset($treatmentData['treatment_composition'][0]) &&
        is_array($treatmentData['treatment_composition'][0]) &&
        isset($treatmentData['treatment_composition'][0][0])) {
        $treatmentData['treatment_composition'] = $treatmentData['treatment_composition'][0];
    }

    if (isset($treatmentData['parcels_concerned']) && is_array($treatmentData['parcels_concerned'])) {
        $treatmentUnit = getTreatmentVolumeUnit($treatmentData);
        foreach ($treatmentData['parcels_concerned'] as &$parcel) {
            if (!is_array($parcel)) continue;
            if (isset($parcel['parcel_surface_treated'])) {
                $surfaceValue = floatval($parcel['parcel_surface_treated']);
                $surfaceUnit = $parcel['surface_unit'] ?? 'ha';
                $standardSurface = convertSurfaceToHectares($surfaceValue, $surfaceUnit);
                $parcel['standard_surface_treated'] = round($standardSurface, 4);
            } elseif (!isset($parcel['standard_surface_treated'])) {
                $parcel['standard_surface_treated'] = floatval($parcel['parcel_surface'] ?? 0);
            }
            if (!isset($parcel['standard_surface_treated']) || !is_numeric($parcel['standard_surface_treated'])) {
                $parcel['standard_surface_treated'] = 0;
            }
            $parcel['treatment_volume_applied_unit'] = $treatmentUnit;
            // Rename inner parcel fields if needed
            if (array_key_exists('parcels_id', $parcel) && !array_key_exists('parcel_id', $parcel)) {
                $parcel['parcel_id'] = $parcel['parcels_id'];
                unset($parcel['parcels_id']);
            }
            if (array_key_exists('parcels_name', $parcel) && !array_key_exists('parcel_name', $parcel)) {
                $parcel['parcel_name'] = $parcel['parcels_name'];
                unset($parcel['parcels_name']);
            }
            // Phytoweb / EPPO / archive field renames
            if (array_key_exists('nomPhytoweb_crops_id', $parcel) && !array_key_exists('phytoweb_name', $parcel)) {
                $parcel['phytoweb_name'] = $parcel['nomPhytoweb_crops_id'];
                unset($parcel['nomPhytoweb_crops_id']);
            }
            if (array_key_exists('phytoweb_crops_id', $parcel) && !array_key_exists('phytoweb_id', $parcel)) {
                $parcel['phytoweb_id'] = $parcel['phytoweb_crops_id'];
                unset($parcel['phytoweb_crops_id']);
            }
            if (array_key_exists('EPPOCode', $parcel) && !array_key_exists('eppo', $parcel)) {
                $parcel['eppo'] = $parcel['EPPOCode'];
                unset($parcel['EPPOCode']);
            }
            if (array_key_exists('isArchived', $parcel) && !array_key_exists('is_archived', $parcel)) {
                $parcel['is_archived'] = $parcel['isArchived'];
                unset($parcel['isArchived']);
            }
        }
        unset($parcel);
    }

    // Migrer root target → chaque entrée de treatment_composition, puis supprimer root target.
    // Pour les futurs encodages, target est stocké uniquement au niveau des compositions.
    if (isset($treatmentData['treatment_composition']) && is_array($treatmentData['treatment_composition'])) {
        $rootTarget = isset($treatmentData['target']) ? $treatmentData['target'] : null;
        foreach ($treatmentData['treatment_composition'] as &$comp) {
            if (!is_array($comp)) continue;
            // Ne copier le root target que si l'entrée n'en a pas déjà un
            if ($rootTarget !== null && !array_key_exists('target', $comp)) {
                $comp['target'] = $rootTarget;
            }
            // Garantir que le champ existe
            if (!array_key_exists('target', $comp)) {
                $comp['target'] = '';
            }
        }
        unset($comp);
        // Supprimer le champ root target (nouvelle structure)
        unset($treatmentData['target']);
    }

    // Assurer structure minimale
    if (!isset($treatmentData['type'])) {
        $treatmentData['type'] = 'phyto_surface_treatment';
    }
    if (!array_key_exists('remark', $treatmentData)) {
        $treatmentData['remark'] = '';
    }
    if (!array_key_exists('clean_flag', $treatmentData)) {
        $treatmentData['clean_flag'] = '';
    }
    if (!array_key_exists('localized_treatment', $treatmentData)) {
        $treatmentData['localized_treatment'] = '';
    }
    if (!array_key_exists('bbch', $treatmentData)) {
        $treatmentData['bbch'] = '';
    }
    if (!array_key_exists('event_hour', $treatmentData)) {
        $treatmentData['event_hour'] = '';
    }
    if (!array_key_exists('operator_name', $treatmentData)) {
        $treatmentData['operator_name'] = '';
    }
    if (!array_key_exists('operator_phytolicence', $treatmentData)) {
        $treatmentData['operator_phytolicence'] = '';
    }
    if (!array_key_exists('operator_id', $treatmentData)) {
        $treatmentData['operator_id'] = '';
    }
    if (!array_key_exists('decision_base', $treatmentData)) {
        $treatmentData['decision_base'] = 'Non définit';
    }
    if (!array_key_exists('effectiveness', $treatmentData)) {
        $treatmentData['effectiveness'] = "Pas d'avis";
    }
}

/**
 * Normalise la structure d'un travail au champ (field_works) vers les nouveaux noms de champs.
 * Peut être appelée sur des enregistrements anciens ou nouveaux (idempotent).
 */
function normalizeFieldWorkStructure(&$workData) {
    if (!is_array($workData)) return;

    // travaux_aux_champs_id → event_id
    if (array_key_exists('travaux_aux_champs_id', $workData) && !array_key_exists('event_id', $workData)) {
        $workData['event_id'] = $workData['travaux_aux_champs_id'];
        unset($workData['travaux_aux_champs_id']);
    }
    // type_travaux_aux_champs → type
    if (array_key_exists('type_travaux_aux_champs', $workData) && !array_key_exists('type', $workData)) {
        $workData['type'] = $workData['type_travaux_aux_champs'];
        unset($workData['type_travaux_aux_champs']);
    }
    // datee → date
    if (array_key_exists('datee', $workData) && !array_key_exists('date', $workData)) {
        $workData['date'] = $workData['datee'];
        unset($workData['datee']);
    }
    // outil → tool
    if (array_key_exists('outil', $workData) && !array_key_exists('tool', $workData)) {
        $workData['tool'] = $workData['outil'];
        unset($workData['outil']);
    }
    // remaques → remark
    if (array_key_exists('remaques', $workData) && !array_key_exists('remark', $workData)) {
        $workData['remark'] = $workData['remaques'];
        unset($workData['remaques']);
    }
    // lha → dose_unit
    if (array_key_exists('lha', $workData) && !array_key_exists('dose_unit', $workData)) {
        $workData['dose_unit'] = $workData['lha'];
        unset($workData['lha']);
    }
    // dateDeRecolte → harvest_date
    if (array_key_exists('dateDeRecolte', $workData) && !array_key_exists('harvest_date', $workData)) {
        $workData['harvest_date'] = $workData['dateDeRecolte'];
        unset($workData['dateDeRecolte']);
    }
    // dateFinRecolte → supprimé (champ inutile)
    unset($workData['dateFinRecolte']);
    // travailtype → field_work_type
    if (array_key_exists('travailtype', $workData) && !array_key_exists('field_work_type', $workData)) {
        $workData['field_work_type'] = $workData['travailtype'];
        unset($workData['travailtype']);
    }

    // Normaliser les champs internes de parcels_concerned
    if (isset($workData['parcels_concerned']) && is_array($workData['parcels_concerned'])) {
        foreach ($workData['parcels_concerned'] as &$parcel) {
            if (!is_array($parcel)) continue;
            if (array_key_exists('parcels_id', $parcel) && !array_key_exists('parcel_id', $parcel)) {
                $parcel['parcel_id'] = $parcel['parcels_id'];
                unset($parcel['parcels_id']);
            }
            if (array_key_exists('parcels_name', $parcel) && !array_key_exists('parcel_name', $parcel)) {
                $parcel['parcel_name'] = $parcel['parcels_name'];
                unset($parcel['parcels_name']);
            }
            if (array_key_exists('nomPhytoweb_crops_id', $parcel) && !array_key_exists('phytoweb_name', $parcel)) {
                $parcel['phytoweb_name'] = $parcel['nomPhytoweb_crops_id'];
                unset($parcel['nomPhytoweb_crops_id']);
            }
            if (array_key_exists('EPPOCode', $parcel) && !array_key_exists('eppo', $parcel)) {
                $parcel['eppo'] = $parcel['EPPOCode'];
                unset($parcel['EPPOCode']);
            }
        }
        unset($parcel);
    }
}

function consolidateAllTreatmentCalculations(&$treatmentData) {
    $modifications = [];
    
    normalizePhytoTreatmentStructure($treatmentData);
    
    if (ensureStandardTotalSurfaceTreated($treatmentData)) {
        $modifications[] = 'standard_total_surface_treated';
    }
    
    $volumeModifications = calculateTreatmentVolumeApplied($treatmentData);
    if ($volumeModifications > 0) {
        $modifications[] = "treatment_volume_applied ($volumeModifications parcelles)";
    }
    
    $quantityModifications = calculateComponentQuantities($treatmentData);
    if ($quantityModifications > 0) {
        $modifications[] = "component_quantity ($quantityModifications produits)";
    }
    
    $treatmentType = $treatmentData['type'] ?? '';
    $isBouillieMode = false;
    
    if (strpos($treatmentType, 'bouillie') !== false || strpos($treatmentType, 'porridge') !== false) {
        $isBouillieMode = true;
    }
    
    if (!$isBouillieMode && 
        isset($treatmentData['treatment_total_quantity_used']) && 
        isset($treatmentData['treatment_total_quantity']) &&
        !empty($treatmentData['treatment_total_quantity']) &&
        trim($treatmentData['treatment_total_quantity']) !== '' &&
        floatval($treatmentData['treatment_total_quantity_used']) > 0 &&
        floatval($treatmentData['treatment_total_quantity']) > 0) {
        $isBouillieMode = true;
    }
    
    if (isset($treatmentData['treatment_composition']) && is_array($treatmentData['treatment_composition'])) {
        if (!$isBouillieMode) {
            $newTotalQuantity = 0;
            foreach ($treatmentData['treatment_composition'] as $component) {
                if (!is_array($component)) continue;
                $componentQuantity = floatval($component['component_quantity'] ?? 0);
                $newTotalQuantity += $componentQuantity;
            }

            $oldTotalQuantity = floatval($treatmentData['treatment_total_quantity_used'] ?? 0);
            $newTotalQuantityRounded = round($newTotalQuantity, 2);

            if (abs($newTotalQuantityRounded - $oldTotalQuantity) > 0.01) {
                $treatmentData['treatment_total_quantity_used'] = $newTotalQuantityRounded;
                $modifications[] = "treatment_total_quantity_used ($oldTotalQuantity → $newTotalQuantityRounded)";
            }
        }
    }
    
    if (!empty($modifications)) {
        $treatmentData['calculations_consolidated_at'] = date('c');
        $treatmentData['frontend_refresh_key'] = time() . '.' . uniqid('', true);
    }
    
    return count($modifications) > 0;
}

// ============================================================================
// ROUTAGE HTTP
// ============================================================================

/**
 * Dispatch les actions PUT liées aux traitements (update_parcel_name, ensure_all_surfaces).
 * Appelle exit() si une action est traitée, sinon retourne sans rien faire.
 */
function handleTreatmentActionRoutes($action, $file, $fullPath, $baseDir) {
    if ($action === 'update_parcel_name_in_treatments') {
        $oldParcelName = $_GET['old_parcel_name'] ?? null;
        $newParcelName = $_GET['new_parcel_name'] ?? null;

        if (!$oldParcelName || !$newParcelName) {
            http_response_code(400);
            echo json_encode([
                'error' => 'Paramètres old_parcel_name et new_parcel_name requis.',
                'provided' => [
                    'old_parcel_name' => $oldParcelName,
                    'new_parcel_name' => $newParcelName
                ]
            ]);
            exit;
        }

        $treatmentFiles = [
            $baseDir . 'events/phyto_treatments_final.json',
            $baseDir . 'events/phyto_treatments.json'
        ];

        $totalUpdated = 0;
        $filesProcessed = [];

        foreach ($treatmentFiles as $treatmentFile) {
            $fileUpdated = 0;
            if (is_file($treatmentFile)) {
                $content = file_get_contents($treatmentFile);
                $treatments = json_decode($content, true);
                if (json_last_error() === JSON_ERROR_NONE && is_array($treatments)) {
                    foreach ($treatments as &$treatment) {
                        if (isset($treatment['parcels_concerned']) && is_array($treatment['parcels_concerned'])) {
                            $modified = false;
                            foreach ($treatment['parcels_concerned'] as &$parcel) {
                                if (!is_array($parcel)) continue;
                                if (isset($parcel['parcel_name']) && $parcel['parcel_name'] === $oldParcelName) {
                                    $parcel['parcel_name'] = $newParcelName;
                                    $modified = true;
                                }
                                // legacy field name backward-compat
                                if (isset($parcel['parcels_name']) && $parcel['parcels_name'] === $oldParcelName) {
                                    $parcel['parcels_name'] = $newParcelName;
                                    $modified = true;
                                }
                            }
                            unset($parcel);
                            if ($modified) {
                                $treatment['updated_parcel_name_at'] = date('c');
                                $fileUpdated++;
                                $totalUpdated++;
                            }
                        }
                    }
                    unset($treatment);
                    if ($fileUpdated > 0) {
                        file_put_contents($treatmentFile, json_encode($treatments, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
                    }
                }
            }
            $filesProcessed[] = [
                'file' => basename($treatmentFile),
                'updated_count' => $fileUpdated,
                'exists' => is_file($treatmentFile)
            ];
        }

        echo json_encode([
            'success' => true,
            'message' => "Mise à jour du nom de parcelle terminée: $totalUpdated traitement(s) mis à jour",
            'old_parcel_name' => $oldParcelName,
            'new_parcel_name' => $newParcelName,
            'total_updated' => $totalUpdated,
            'files_processed' => $filesProcessed
        ]);
        exit;
    }

    if ($action === 'ensure_all_surfaces') {
        if (!is_file($fullPath)) {
            http_response_code(404);
            echo json_encode(['error' => 'Fichier phyto_treatments_final.json non trouvé.']);
            exit;
        }

        $content = file_get_contents($fullPath);
        $treatments = json_decode($content, true);

        if (json_last_error() !== JSON_ERROR_NONE || !is_array($treatments)) {
            http_response_code(400);
            echo json_encode(['error' => 'Fichier JSON invalide.']);
            exit;
        }

        $updatedCount = 0;
        foreach ($treatments as &$treatment) {
            if (ensureStandardTotalSurfaceTreated($treatment)) {
                $updatedCount++;
            }
        }

        if ($updatedCount > 0) {
            atomicWriteJsonFile($fullPath, $treatments);
        }

        echo json_encode([
            'success' => true,
            'message' => "Calcul automatique des surfaces terminé: $updatedCount traitement(s) mis à jour",
            'updated_count' => $updatedCount,
            'total_treatments' => count($treatments)
        ]);
        exit;
    }
}
?>
