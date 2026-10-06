import { Injectable, computed, signal } from '@angular/core';
import { MandatService, Mandat } from './mandat.service';

export interface WorkspaceOption {
  userId: string;
  label: string;
  isMine: boolean;
}

@Injectable({ providedIn: 'root' })
export class MandatWorkspaceService {
  /** L'id_user dont on consulte les données (null = les miennes) */
  activeWorkspaceUserId = signal<string | null>(null);

  /** Options disponibles dans le dropdown (mes données + mandats acceptés en tant que mandaté) */
  workspaceOptions = computed<WorkspaceOption[]>(() => {
    const myId = localStorage.getItem('Ref') ?? '';
    const myMail = (localStorage.getItem('Mail') ?? '').toLowerCase();
    const myPrenom = localStorage.getItem('Prenom') ?? '';
    const myNom = localStorage.getItem('Nom') ?? '';

    const mine: WorkspaceOption = {
      userId: myId,
      label: `${myPrenom} ${myNom}`.trim() || myMail || 'Mon exploitation',
      isMine: true
    };

    // Mandats acceptés où je suis le MANDATÉ → j'accède aux données du owner
    const delegated = this.mandatService.mandats()
      .filter(m =>
        m.status === 'accepted' &&
        m.mandateUserMail.toLowerCase() === myMail
      )
      .map(m => ({
        userId: m.ownerUserId,
        label: m.mandateName || m.ownerUserMail,
        isMine: false
      }));

    return [mine, ...delegated];
  });

  /** Label de l'espace actif */
  activeLabel = computed<string>(() => {
    const active = this.activeWorkspaceUserId();
    const opt = this.workspaceOptions().find(o => o.userId === active);
    return opt?.label ?? this.workspaceOptions()[0]?.label ?? 'Mon exploitation';
  });

  /** Indique si on est dans l'espace d'un autre utilisateur */
  isInDelegatedWorkspace = computed<boolean>(() => {
    const active = this.activeWorkspaceUserId();
    return !!active && active !== (localStorage.getItem('Ref') ?? '');
  });

  constructor(private mandatService: MandatService) {
    // Restaurer le workspace actif depuis sessionStorage dès l'initialisation du service
    // pour que l'interceptor ait la valeur correcte dès la première requête HTTP
    const storedWs = sessionStorage.getItem('activeWorkspace');
    if (storedWs) {
      this.activeWorkspaceUserId.set(storedWs);
    }
  }

  /** Basculer vers un espace de travail */
  switchWorkspace(userId: string): void {
    const myId = localStorage.getItem('Ref') ?? '';
    this.activeWorkspaceUserId.set(userId === myId ? null : userId);
  }

  /** Charger les mandats (à appeler au login / init du header) */
  init(): void {
    this.mandatService.loadMandats();
  }

  /** Retourne l'id_user effectif à envoyer dans le header (null si mes propres données) */
  getWorkspaceHeader(): string | null {
    return this.activeWorkspaceUserId();
  }

  /** userId actif pour le binding du select (retourne myId si pas de délégation active) */
  getSelectedUserId(): string {
    return this.activeWorkspaceUserId() ?? (localStorage.getItem('Ref') ?? '');
  }
}
