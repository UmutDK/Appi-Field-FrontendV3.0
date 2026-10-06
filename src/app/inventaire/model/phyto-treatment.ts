export interface TreatmentComponent {
  component_id: string;
  component_name: string;
  component_numaut: string;
  component_type: string;
  component_dose: number;
  component_dose_unit: string;
  standard_component_dose: number;
  component_quantity: number;
}

export interface PhytoTreatment {
  event_id: string;
  treatment_date: string;
  treatment_type: string;
  target: string | null;
  remarks: string | null;
  cleaning_performed: string;
  local_treatment: string;
  harvest_date: string | null;
  bbch_stage: string | null;
  total_quantity_used: number;
  total_surface_treated?: number;
  parcels: any[];
  treatment_components: TreatmentComponent[];
  created_at: string;
}
