import { Injectable } from '@angular/core';

export interface TreatmentCalculationResult {
  modified: boolean;
  changes: string[];
  errors: string[];
}

@Injectable({
  providedIn: 'root'
})
export class CalculationConsolidationService {

  /**
   * Consolidation complète de tous les calculs pour un traitement
   */
  consolidateAllCalculations(treatment: any, skipVolumeRecalculation: boolean = false): TreatmentCalculationResult {
    const result: TreatmentCalculationResult = {
      modified: false,
      changes: [],
      errors: []
    };

    if (!treatment) {
      result.errors.push('Traitement non fourni');
      return result;
    }

    // 🔧 DÉTECTION MODE BOUILLIE
    const isBouillieMode = this.isBouillieMode(treatment);

    // 1. Consolidation de standard_total_surface_treated
    const surfaceResult = this.consolidateStandardTotalSurfaceTreated(treatment);
    this.mergeResults(result, surfaceResult);

    // 2. Consolidation de treatment_volume_applied pour chaque parcelle
    const volumeResult = this.consolidateTreatmentVolumeApplied(treatment, isBouillieMode, skipVolumeRecalculation);
    this.mergeResults(result, volumeResult);

    // 3. Consolidation de component_quantity pour chaque produit
    const quantityResult = this.consolidateComponentQuantities(treatment, isBouillieMode);
    this.mergeResults(result, quantityResult);

    // 4. Marquer la consolidation si modifications
    if (result.modified) {
      treatment.calculations_consolidated_at = new Date().toISOString();
      result.changes.push('Timestamp de consolidation mis à jour');
    }

    return result;
  }

  /**
   * 🔧 Détecte si le traitement est en mode bouillie
   */
  private isBouillieMode(treatment: any): boolean {
    return treatment.type === 'phyto_porridge_treatment' ||
           (treatment.type && treatment.type.includes('bouillie')) ||
           (treatment.type && treatment.type.includes('porridge'));
  }

  /**
   * Calcule et vérifie standard_total_surface_treated
   */
  private consolidateStandardTotalSurfaceTreated(treatment: any): TreatmentCalculationResult {
    const result: TreatmentCalculationResult = {
      modified: false,
      changes: [],
      errors: []
    };

    if (!treatment.parcels_concerned?.[0] || !Array.isArray(treatment.parcels_concerned[0])) {
      result.errors.push('Aucune parcelle concernée trouvée');
      return result;
    }

    // Calculer la surface totale depuis les parcelles
    const totalSurface = treatment.parcels_concerned[0].reduce((total: number, parcel: any) => {
      const surface = parseFloat(parcel.parcel_surface_treated || parcel.standard_surface_treated) || 0;
      return total + surface;
    }, 0);

    const currentValue = parseFloat(treatment.standard_total_surface_treated) || 0;
    
    if (totalSurface === 0) {
      result.errors.push('Surface totale calculée est 0');
      return result;
    }

    // Vérifier si recalcul nécessaire (tolérance de 0.01 pour les arrondis)
    if (Math.abs(currentValue - totalSurface) > 0.01) {
      treatment.standard_total_surface_treated = parseFloat(totalSurface.toFixed(3));
      result.modified = true;
      result.changes.push(`standard_total_surface_treated: ${currentValue} → ${totalSurface}`);
    }

    return result;
  }

  /**
   * Calcule treatment_volume_applied pour chaque parcelle
   * 🔧 Mode bouillie : garde les volumes manuels, mode surface : recalcule proportionnellement
   */
  private consolidateTreatmentVolumeApplied(treatment: any, isBouillieMode: boolean = false, skipVolumeRecalculation: boolean = false): TreatmentCalculationResult {
    const result: TreatmentCalculationResult = {
      modified: false,
      changes: [],
      errors: []
    };

    if (!treatment.parcels_concerned?.[0] || !Array.isArray(treatment.parcels_concerned[0])) {
      result.errors.push('Aucune parcelle pour calculer treatment_volume_applied');
      return result;
    }

    // 🥣 MODE BOUILLIE : Préserver les volumes saisis manuellement
    if (isBouillieMode) {
      
      // Calculer le nouveau volume total selon les parcelles
      let sumVolumes = 0;
      treatment.parcels_concerned[0].forEach((parcel: any) => {
        const parcelVolume = parseFloat(parcel.treatment_volume_applied) || 0;
        sumVolumes += parcelVolume;
      });
            
      // Mettre à jour le volume total selon la répartition
      const currentTotalUsed = parseFloat(treatment.treatment_total_quantity_used) || 0;
      
      if (Math.abs(currentTotalUsed - sumVolumes) > 0.01) {
        treatment.treatment_total_quantity_used = parseFloat(sumVolumes.toFixed(3));
        result.changes.push(`🥣 Volume total ajusté selon répartition: ${currentTotalUsed}L → ${sumVolumes}L`);
        result.modified = true;
      }
      
      // ✅ NE PAS recalculer les volumes individuels en mode modification manuelle
      if (skipVolumeRecalculation) {
        return result;
      }
      
      return result; // Volume ajusté selon la répartition manuelle
    }

    
    // ✅ En mode surface, skipVolumeRecalculation peut aussi s'appliquer
    if (skipVolumeRecalculation) {
      return result;
    }
    
    const totalVolumeUsed = parseFloat(treatment.treatment_total_quantity_used) || 0;
    const totalSurface = parseFloat(treatment.standard_total_surface_treated) || 0;

    if (totalVolumeUsed <= 0) {
      result.errors.push('Volume total utilisé manquant ou invalide');
      return result;
    }

    if (totalSurface <= 0) {
      result.errors.push('Surface totale manquante ou invalide');
      return result;
    }

    let modificationsCount = 0;
    treatment.parcels_concerned[0].forEach((parcel: any) => {
      const parcelSurface = parseFloat(parcel.standard_surface_treated) || 0;
      if (parcelSurface > 0) {
        const calculatedVolume = (parcelSurface / totalSurface) * totalVolumeUsed;
        const oldVolume = parseFloat(parcel.treatment_volume_applied) || 0;
        
        if (Math.abs(oldVolume - calculatedVolume) > 0.01) {
          parcel.treatment_volume_applied = parseFloat(calculatedVolume.toFixed(3));
          result.changes.push(`Parcelle ${parcel.parcel_id ?? parcel.parcels_id}: treatment_volume_applied ${oldVolume} → ${parcel.treatment_volume_applied}`);
          modificationsCount++;
        }
      }
    });

    if (modificationsCount > 0) {
      result.modified = true;
    }

    return result;
  }

  /**
   * Calcule component_quantity pour chaque produit
   * 🔧 Mode bouillie : préserve les quantités calculées selon le volume, mode surface : recalcule selon la surface
   */
  private consolidateComponentQuantities(treatment: any, isBouillieMode: boolean = false): TreatmentCalculationResult {
    const result: TreatmentCalculationResult = {
      modified: false,
      changes: [],
      errors: []
    };

    const comp = treatment.treatment_composition;
    if (!comp || !Array.isArray(comp)) {
      result.errors.push('Aucune composition pour calculer component_quantity');
      return result;
    }
    const components = (Array.isArray(comp[0]) && Array.isArray(comp[0][0])) ? comp[0] : comp;
    if (!components || !Array.isArray(components)) {
      result.errors.push('Aucune composition pour calculer component_quantity');
      return result;
    }

    // 🥣 MODE BOUILLIE : Recalculer les quantités selon le volume total consolidé
    if (isBouillieMode) {
      
      // Utiliser le volume total qui vient d'être consolidé par consolidateTreatmentVolumeApplied
      const totalVolumeUsed = parseFloat(treatment.treatment_total_quantity_used) || 0;
      
      if (totalVolumeUsed <= 0) {
        result.errors.push('Volume total utilisé manquant pour calculer les quantités en mode bouillie');
        return result;
      }
      
      // Recalculer les quantités de produits selon le volume total consolidé
      let modificationsCount = 0;
      components.forEach((component: any) => {
        const dose = parseFloat(component.component_dose) || 0;
        const facteurConversion = this.onReference(component.component_dose_unit);
        
        // Calcul bouillie : quantité = (dose × facteur × volume_total) / 1000
        const calculatedQuantity = (dose * facteurConversion * totalVolumeUsed) / 1000;
        const oldQuantity = parseFloat(component.component_quantity) || 0;
        
        if (Math.abs(oldQuantity - calculatedQuantity) > 0.001) {
          component.component_quantity = parseFloat(calculatedQuantity.toFixed(6));
          result.changes.push(`🥣 Produit ${component.component_name}: quantité ${oldQuantity} → ${component.component_quantity} (volume total: ${totalVolumeUsed}L)`);
          modificationsCount++;
          result.modified = true;
        }
      });
      
      return result;
    }
    
    const totalSurface = parseFloat(treatment.standard_total_surface_treated) || 0;

    if (totalSurface <= 0) {
      result.errors.push('Surface totale manquante pour calculer component_quantity');
      return result;
    }

    let modificationsCount = 0;
    let newTotalQuantityUsed = 0;

    components.forEach((component: any) => {
      const standardDose = parseFloat(component.standard_component_dose) || 0;
      if (standardDose > 0) {
        const calculatedQuantity = standardDose * totalSurface;
        const oldQuantity = parseFloat(component.component_quantity) || 0;
        
        if (Math.abs(oldQuantity - calculatedQuantity) > 0.01) {
          component.component_quantity = parseFloat(calculatedQuantity.toFixed(3));
          result.changes.push(`Produit ${component.component_name}: component_quantity ${oldQuantity} → ${component.component_quantity}`);
          modificationsCount++;
        }
      }
      
      newTotalQuantityUsed += parseFloat(component.component_quantity) || 0;
    });

    // Vérifier treatment_total_quantity_used
    const oldTotalQuantity = parseFloat(treatment.treatment_total_quantity_used) || 0;
    if (Math.abs(oldTotalQuantity - newTotalQuantityUsed) > 0.01) {
      treatment.treatment_total_quantity_used = parseFloat(newTotalQuantityUsed.toFixed(3));
      result.changes.push(`treatment_total_quantity_used: ${oldTotalQuantity} → ${treatment.treatment_total_quantity_used}`);
      result.modified = true;
    }

    if (modificationsCount > 0) {
      result.modified = true;
    }

    return result;
  }

  /**
   * Fusionne les résultats de consolidation
   */
  private mergeResults(target: TreatmentCalculationResult, source: TreatmentCalculationResult): void {
    if (source.modified) {
      target.modified = true;
    }
    target.changes.push(...source.changes);
    target.errors.push(...source.errors);
  }

  /**
   * Validation complète d'un traitement avant sauvegarde
   */
  validateTreatmentCalculations(treatment: any): TreatmentCalculationResult {
    const result: TreatmentCalculationResult = {
      modified: false,
      changes: [],
      errors: []
    };

    if (!treatment) {
      result.errors.push('Traitement non fourni pour validation');
      return result;
    }

    // Vérifications de cohérence
    const totalSurface = parseFloat(treatment.standard_total_surface_treated) || 0;
    const totalQuantity = parseFloat(treatment.treatment_total_quantity_used) || 0;

    if (totalSurface <= 0) {
      result.errors.push('Surface totale traitée manquante ou invalide');
    }

    if (totalQuantity <= 0) {
      result.errors.push('Quantité totale utilisée manquante ou invalide');
    }

    // Vérifier les parcelles
    const pc = treatment.parcels_concerned;
    if (pc && Array.isArray(pc)) {
      const flatParcels = (Array.isArray(pc[0]) && Array.isArray(pc[0][0])) ? pc[0] : pc;
      const parcelsWithoutVolume = flatParcels.filter((p: any) =>
        !p.treatment_volume_applied || parseFloat(p.treatment_volume_applied) <= 0
      );

      if (parcelsWithoutVolume.length > 0) {
        result.errors.push(`${parcelsWithoutVolume.length} parcelle(s) sans treatment_volume_applied`);
      }
    }

    // Vérifier les produits
    const tc = treatment.treatment_composition;
    if (tc && Array.isArray(tc)) {
      const flatComps = (Array.isArray(tc[0]) && Array.isArray(tc[0][0])) ? tc[0] : tc;
      const componentsWithoutQuantity = flatComps.filter((c: any) =>
        !c.component_quantity || parseFloat(c.component_quantity) <= 0
      );

      if (componentsWithoutQuantity.length > 0) {
        result.errors.push(`${componentsWithoutQuantity.length} produit(s) sans component_quantity`);
      }
    }

    if (result.errors.length === 0) {
      result.changes.push('Tous les calculs sont cohérents');
    }

    return result;
  }

  /**
   * Convertit les unités de dose en facteur de conversion
   * Mode Surface: normalise vers L/ha ou kg/ha
   * Mode Bouillie: normalise vers L/100L ou kg/100L
   */
  private onReference(littre: string): number {
    // === UNITÉS DE SURFACE (pour parcelles) ===
    if ("m2" === littre) {
      return 0.0001; // 1 m² = 0.0001 ha
    } else if ("ha" === littre) {
      return 1;
    } else if ("a" === littre) {
      return 0.01; // 1 are = 0.01 ha
    }
    
    // === MODE SURFACE - Par hectare ===
    else if ("L/ha" === littre || "kg/ha" === littre) {
      return 1;
    } else if ("g/ha" === littre || "ml/ha" === littre) {
      return 0.001; // g→kg, ml→L
    }
    // Par are (1 ha = 100 a)
    else if ("L/a" === littre || "kg/a" === littre) {
      return 100; // 1 L/a = 100 L/ha
    } else if ("g/a" === littre || "ml/a" === littre) {
      return 0.1; // 100 × 0.001 = 0.1
    }
    // Par m² (1 ha = 10000 m²)
    else if ("L/m2" === littre || "kg/m2" === littre) {
      return 10000; // 1 L/m² = 10000 L/ha
    } else if ("g/m2" === littre || "ml/m2" === littre) {
      return 10; // 10000 × 0.001 = 10
    }
    
    // === MODE BOUILLIE - Par 100L ===
    else if ("L/100L" === littre || "kg/100L" === littre) {
      return 1;
    } else if ("ml/100L" === littre || "g/100L" === littre) {
      return 0.001; // ml→L, g→kg
    }
    // Par 10L de bouillie (100L = 10 × 10L)
    else if ("L/10L" === littre || "kg/10L" === littre) {
      return 10; // 1 L/10L = 10 L/100L
    } else if ("ml/10L" === littre || "g/10L" === littre) {
      return 0.01; // 10 × 0.001 = 0.01
    }
    // Par litre de bouillie (100L = 100 × 1L)
    else if ("ml/L" === littre || "g/L" === littre) {
      return 0.1; // 100 × 0.001 = 0.1
    }
    
    // === QUANTITÉS TOTALES ===
    else if ("L" === littre || "Kg" === littre) {
      return 1; // Géré différemment dans le calcul
    }
    
    else {
      return 0;
    }
  }
}
