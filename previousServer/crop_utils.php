<?php
/**
 * Fonctions utilitaires pour la gestion des cultures
 * Suppression en cascade des cultures dans les parcelles et traitements
 */

function removeCropFromParcelsLists($cropId, $userId = null) {
    $affectedTreatments = [];
    $totalModifications = 0;
    
    $baseDir = __DIR__ . '/';
    
    // 1. Traiter les travaux aux champs (field_works.json)
    $fieldWorksPath = $baseDir . 'events/field_works.json';
    
    if (file_exists($fieldWorksPath)) {
        $fieldWorksData = file_get_contents($fieldWorksPath);
        
        if ($fieldWorksData !== false) {
            $fieldWorks = json_decode($fieldWorksData, true);
        
            if (json_last_error() === JSON_ERROR_NONE && is_array($fieldWorks)) {
                $fieldWorksModified = false;
            
                foreach ($fieldWorks as &$work) {
                    if (isset($work['parcels_concerned']) && is_array($work['parcels_concerned']) && !empty($work['parcels_concerned'])) {
                        $originalCount = count($work['parcels_concerned']);
                        
                        $filteredParcels = array_filter($work['parcels_concerned'], function($parcel) use ($cropId) {
                            if (!is_array($parcel) || !isset($parcel['crop_id'])) {
                                return true;
                            }
                            return $parcel['crop_id'] !== $cropId;
                        });
                        
                        $work['parcels_concerned'] = array_values($filteredParcels);
                        
                        $newCount = count($filteredParcels);
                        if ($newCount < $originalCount) {
                            $fieldWorksModified = true;
                            $totalModifications += ($originalCount - $newCount);
                        }
                    }
                }
            
                if ($fieldWorksModified) {
                    file_put_contents($fieldWorksPath, json_encode($fieldWorks, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
                }
            }
        }
    }
    
    // 2. Traiter les traitements phytosanitaires (phyto_treatments_final.json)
    $treatmentsPath = $baseDir . 'events/phyto_treatments_final.json';
    
    if (file_exists($treatmentsPath)) {
        $treatmentsData = file_get_contents($treatmentsPath);
        
        if ($treatmentsData !== false) {
            $treatments = json_decode($treatmentsData, true);
            
            if (json_last_error() === JSON_ERROR_NONE && is_array($treatments)) {
                $treatmentsModified = false;
                
                foreach ($treatments as &$treatment) {
                    if (isset($treatment['parcels_concerned']) && is_array($treatment['parcels_concerned']) && !empty($treatment['parcels_concerned'])) {
                        $originalCount = count($treatment['parcels_concerned']);
                        $modified = false;

                        // flat structure: filter parcels directly
                        $filteredParcels = array_filter($treatment['parcels_concerned'], function($parcel) use ($cropId) {
                            if (!is_array($parcel) || !isset($parcel['crop_id'])) {
                                return true;
                            }
                            return $parcel['crop_id'] !== $cropId;
                        });
                        $treatment['parcels_concerned'] = array_values($filteredParcels);

                        if (count($treatment['parcels_concerned']) < $originalCount) {
                            $modified = true;
                        }

                        if ($modified) {
                            $treatmentsModified = true;
                            $totalModifications += ($originalCount - count($treatment['parcels_concerned']));

                            $hasParcels = !empty($treatment['parcels_concerned']);

                            if ($hasParcels) {
                                $treatmentType = $treatment['type'] ?? '';
                                $isBouillieMode = (strpos($treatmentType, 'bouillie') !== false) ||
                                                  (strpos($treatmentType, 'porridge') !== false) ||
                                                  (isset($treatment['treatment_total_quantity_used']) &&
                                                   isset($treatment['treatment_total_quantity']) &&
                                                   !empty($treatment['treatment_total_quantity']) &&
                                                   floatval($treatment['treatment_total_quantity_used']) > 0 &&
                                                   floatval($treatment['treatment_total_quantity']) > 0);

                                if ($isBouillieMode) {
                                    if (function_exists('ensureStandardTotalSurfaceTreated')) {
                                        ensureStandardTotalSurfaceTreated($treatment);
                                    }

                                    $sumVolume = 0.0;
                                    foreach ($treatment['parcels_concerned'] as $parcel) {
                                        if (is_array($parcel)) {
                                            $sumVolume += floatval($parcel['treatment_volume_applied'] ?? 0);
                                        }
                                    }

                                    $roundedSum = round($sumVolume, 3);
                                    $oldTotal = floatval($treatment['treatment_total_quantity_used'] ?? 0);
                                    if (abs($roundedSum - $oldTotal) > 0.0005) {
                                        $treatment['treatment_total_quantity_used'] = $roundedSum;
                                    }

                                    if (isset($treatment['treatment_composition']) && is_array($treatment['treatment_composition'])) {
                                        $totalVolumeUsed = floatval($treatment['treatment_total_quantity_used'] ?? 0);
                                        foreach ($treatment['treatment_composition'] as &$component) {
                                            if (!is_array($component)) continue;
                                            $componentDose = floatval($component['standard_component_dose'] ?? $component['component_dose'] ?? 0);
                                            if ($componentDose > 0 && $totalVolumeUsed > 0) {
                                                $component['component_quantity'] = round(($componentDose / 100) * $totalVolumeUsed, 3);
                                            } else {
                                                $component['component_quantity'] = 0;
                                            }
                                        }
                                        unset($component);
                                    }

                                    $treatment['calculations_consolidated_at'] = date('c');
                                } else {
                                    if (function_exists('consolidateAllTreatmentCalculations')) {
                                        consolidateAllTreatmentCalculations($treatment);
                                    }
                                }

                                $affectedTreatments[] = $treatment['event_id'] ?? 'N/A';
                            } else {
                                $treatment['standard_total_surface_treated'] = 0;
                                $treatment['treatment_total_quantity_used'] = 0;

                                if (isset($treatment['treatment_composition']) && is_array($treatment['treatment_composition'])) {
                                    foreach ($treatment['treatment_composition'] as &$component) {
                                        if (is_array($component)) $component['component_quantity'] = 0;
                                    }
                                    unset($component);
                                }

                                $treatment['calculations_consolidated_at'] = date('c');
                                $affectedTreatments[] = $treatment['event_id'] ?? 'N/A';
                            }
                        }
                    }
                }
                
                if ($treatmentsModified) {
                    $jsonData = json_encode($treatments, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
                    $tmpFile = $treatmentsPath . '.tmp';
                    $fpw = fopen($tmpFile, 'wb');
                    if ($fpw) {
                        $writeSuccess = false;
                        if (flock($fpw, LOCK_EX)) {
                            $writeSuccess = fwrite($fpw, $jsonData) !== false;
                            fflush($fpw);
                            flock($fpw, LOCK_UN);
                        }
                        fclose($fpw);
                        
                        if ($writeSuccess && file_exists($tmpFile)) {
                            if (!rename($tmpFile, $treatmentsPath)) {
                                if (file_exists($tmpFile)) {
                                    unlink($tmpFile);
                                }
                                file_put_contents($treatmentsPath, $jsonData);
                            }
                        } else {
                            if (file_exists($tmpFile)) {
                                unlink($tmpFile);
                            }
                            file_put_contents($treatmentsPath, $jsonData);
                        }
                    } else {
                        file_put_contents($treatmentsPath, $jsonData);
                    }

                    if (!empty($affectedTreatments)) {
                        updateInventoryForModifiedTreatmentsDirect($treatments, $affectedTreatments, $userId, $baseDir);
                    }
                }
            }
        }
    }

    // 3. Mettre à jour exploitation/parcels.json
    $parcelsPath = $baseDir . 'exploitation/parcels.json';
    if (file_exists($parcelsPath)) {
        $parcelsData = file_get_contents($parcelsPath);
        if ($parcelsData !== false) {
            $parcels = json_decode($parcelsData, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($parcels)) {
                $parcelsModified = false;
                foreach ($parcels as &$parcel) {
                    if (isset($parcel['crop_id']) && $parcel['crop_id'] === $cropId) {
                        if ($userId === null || (isset($parcel['id_user']) && $parcel['id_user'] === $userId)) {
                            $parcel['crop_id'] = '';
                            if (isset($parcel['crop_name'])) $parcel['crop_name'] = '';
                            $parcelsModified = true;
                            $totalModifications++;
                        }
                    }
                }

                if ($parcelsModified) {
                    $tmpFile = $parcelsPath . '.tmp';
                    $fpw = fopen($tmpFile, 'wb');
                    if ($fpw) {
                        $writeSuccess = false;
                        if (flock($fpw, LOCK_EX)) {
                            $writeSuccess = fwrite($fpw, json_encode($parcels, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
                            fflush($fpw);
                            flock($fpw, LOCK_UN);
                        }
                        fclose($fpw);
                        
                        if ($writeSuccess && file_exists($tmpFile)) {
                            if (!rename($tmpFile, $parcelsPath)) {
                                if (file_exists($tmpFile)) {
                                    unlink($tmpFile);
                                }
                                file_put_contents($parcelsPath, json_encode($parcels, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
                            }
                        } else {
                            if (file_exists($tmpFile)) {
                                unlink($tmpFile);
                            }
                            file_put_contents($parcelsPath, json_encode($parcels, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
                        }
                    } else {
                        file_put_contents($parcelsPath, json_encode($parcels, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
                    }
                }
            }
        }
    }

    return [
        'total_modifications' => $totalModifications,
        'affected_treatments' => $affectedTreatments
    ];
}
?>
