import { TestBed } from '@angular/core/testing';
import { CalculationConsolidationService } from './calculation-consolidation.service';

describe('CalculationConsolidationService', () => {
  let service: CalculationConsolidationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CalculationConsolidationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should consolidate standard_total_surface_treated', () => {
    const treatment = {
      parcels_concerned: [[
        { standard_surface_treated: 10.5, parcels_id: 1 },
        { standard_surface_treated: 5.3, parcels_id: 2 }
      ]],
      standard_total_surface_treated: 0
    };

    const result = service.consolidateAllCalculations(treatment);

    expect(result.modified).toBe(true);
    expect(treatment.standard_total_surface_treated).toBe(15.8);
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it('should consolidate treatment_volume_applied', () => {
    const treatment = {
      parcels_concerned: [[
        { standard_surface_treated: 10, parcels_id: 1, treatment_volume_applied: 0 },
        { standard_surface_treated: 5, parcels_id: 2, treatment_volume_applied: 0 }
      ]],
      standard_total_surface_treated: 15,
      treatment_total_quantity_used: 30
    };

    const result = service.consolidateAllCalculations(treatment);

    expect(result.modified).toBe(true);
    expect(treatment.parcels_concerned[0][0].treatment_volume_applied).toBe(20); // 10/15 * 30
    expect(treatment.parcels_concerned[0][1].treatment_volume_applied).toBe(10); // 5/15 * 30
  });

  it('should consolidate component_quantity', () => {
    const treatment = {
      treatment_composition: [[
        { 
          standard_component_dose: 2, 
          component_quantity: 0, 
          component_name: 'Produit A' 
        }
      ]],
      standard_total_surface_treated: 10,
      treatment_total_quantity_used: 0
    };

    const result = service.consolidateAllCalculations(treatment);

    expect(result.modified).toBe(true);
    expect(treatment.treatment_composition[0][0].component_quantity).toBe(20); // 2 * 10
    expect(treatment.treatment_total_quantity_used).toBe(20);
  });

  it('should validate treatment calculations', () => {
    const invalidTreatment = {
      standard_total_surface_treated: 0,
      treatment_total_quantity_used: 10
    };

    const result = service.validateTreatmentCalculations(invalidTreatment);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors).toContain('Surface totale traitée manquante ou invalide');
  });

  it('should detect no changes needed', () => {
    const treatment = {
      parcels_concerned: [[
        { standard_surface_treated: 10, parcels_id: 1, treatment_volume_applied: 20 }
      ]],
      standard_total_surface_treated: 10,
      treatment_total_quantity_used: 20,
      treatment_composition: [[
        { 
          standard_component_dose: 2, 
          component_quantity: 20, 
          component_name: 'Produit A' 
        }
      ]]
    };

    const result = service.consolidateAllCalculations(treatment);

    expect(result.modified).toBe(false);
    expect(result.changes.length).toBe(1); // Timestamp only
  });
});
