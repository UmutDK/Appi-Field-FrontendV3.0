import { Component, OnInit, OnDestroy, AfterViewInit, HostListener } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { SharedModule } from '../../../../shared/shared.module';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AdminService } from '../../../services/admin.service';
import { MandatWorkspaceService } from '../../../services/mandat-workspace.service';
import { Mandat } from '../../../services/mandat.service';
import { environment } from '../../../../../environments/environment';

interface WorkspaceEntry {
  id: string;
  label: string;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit, OnDestroy, AfterViewInit {

  workspaceEntries: WorkspaceEntry[] = [];
  selectedWorkspaceId = '';
  isLoadingWorkspace = false;
  dropdownOpen = false;

  // Sidebar repliable (desktop) — état persisté pour ne pas se réinitialiser à chaque navigation.
  // Largeur exposée en custom property CSS pour que app.component.scss (sibling, pas de lien
  // direct entre les deux composants) puisse décaler .content-wrapper en conséquence.
  collapsed = localStorage.getItem('sidebarCollapsed') === 'true';

  private destroy$ = new Subject<void>();

  private applySidebarWidthVar(): void {
    document.body.style.setProperty('--sidebar-width', this.collapsed ? '76px' : '232px');
  }

  constructor(
    private route: Router,
    private http: HttpClient,
    public adminService: AdminService,
    public mandatWorkspace: MandatWorkspaceService
  ) {}

  ngOnInit(): void {
    this.applySidebarWidthVar();

    // Restore workspace from sessionStorage (déjà fait par MandatWorkspaceService)
    this.selectedWorkspaceId = sessionStorage.getItem('activeWorkspace') ?? '';

    const myMail = (localStorage.getItem('Mail') ?? '').toLowerCase();
    this.http
      .get<Mandat[]>(environment.apiRegistre + '/mandates')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (mandats) => {
          const list = mandats ?? [];

          // Je suis MANDATÉ → j'accède aux données du owner (son exploitation)
          this.workspaceEntries = list
            .filter(m => m.status === 'accepted' && m.mandateUserMail.toLowerCase() === myMail && m.ownerUserId)
            .map(m => ({ id: m.ownerUserId, label: m.mandateName || m.ownerUserMail }));

          // Invalider le workspace stocké si le mandat n'est plus valide
          if (this.selectedWorkspaceId) {
            const stillValid = this.workspaceEntries.some(w => w.id === this.selectedWorkspaceId);
            if (!stillValid) {
              this.selectedWorkspaceId = '';
              sessionStorage.removeItem('activeWorkspace');
              this.mandatWorkspace.activeWorkspaceUserId.set(null);
            }
          }
        },
        error: () => { this.workspaceEntries = []; }
      });
  }

  ngAfterViewInit(): void {
    const mobileNavElement = document.getElementById('mobileNavOffcanvas');
    if (mobileNavElement) {
      mobileNavElement.addEventListener('shown.bs.offcanvas', () => document.body.classList.add('menu-opened'));
      mobileNavElement.addEventListener('hidden.bs.offcanvas', () => document.body.classList.remove('menu-opened'));
    }
  }

  ngOnDestroy(): void {
    document.body.classList.remove('menu-opened');
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.workspace-dropdown')) {
      this.dropdownOpen = false;
    }
    if (!target.closest('.sidebar-admin')) {
      this.adminMenuOpen = false;
    }
  }

  // ==================== MENU ADMIN (sidebar) ====================
  // Sous-menu qui s'ouvre à droite du bouton "Admin" au survol (ou au clic / clavier).
  // Positionné en `fixed` par rapport à l'écran : la sidebar a overflow-x:hidden (repli animé),
  // un sous-menu en `absolute` y serait coupé au bord droit.
  adminMenuOpen = false;
  adminMenuPos = { top: 0, left: 0 };
  private adminMenuCloseTimer: any = null;

  openAdminMenu(anchor: HTMLElement): void {
    clearTimeout(this.adminMenuCloseTimer);
    const rect = anchor.getBoundingClientRect();
    // Aligné sur le bas du bouton si la place manque en dessous (bouton situé en bas de la sidebar)
    const menuHeight = 150;
    const top = rect.top + menuHeight > window.innerHeight ? rect.bottom - menuHeight : rect.top;
    this.adminMenuPos = { top: Math.max(8, top), left: rect.right };
    this.adminMenuOpen = true;
  }

  // Petit délai : laisse le temps de passer du bouton au sous-menu sans qu'il se ferme
  closeAdminMenuSoon(): void {
    clearTimeout(this.adminMenuCloseTimer);
    this.adminMenuCloseTimer = setTimeout(() => this.adminMenuOpen = false, 150);
  }

  toggleAdminMenu(anchor: HTMLElement): void {
    if (this.adminMenuOpen) {
      this.adminMenuOpen = false;
    } else {
      this.openAdminMenu(anchor);
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeCloseAdminMenu(): void {
    this.adminMenuOpen = false;
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    localStorage.setItem('sidebarCollapsed', String(this.collapsed));
    this.applySidebarWidthVar();
  }

  getCurrentWorkspaceName(): string {
    if (!this.selectedWorkspaceId) return 'Mon exploitation';
    const ws = this.workspaceEntries.find(w => w.id === this.selectedWorkspaceId);
    return ws?.label ?? 'Mon exploitation';
  }

  selectWorkspace(id: string): void {
    this.dropdownOpen = false;
    if (id === this.selectedWorkspaceId) return;
    this.selectedWorkspaceId = id;
    const wsId = id === '' ? null : id;
    this.mandatWorkspace.activeWorkspaceUserId.set(wsId);
    if (wsId) {
      sessionStorage.setItem('activeWorkspace', wsId);
    } else {
      sessionStorage.removeItem('activeWorkspace');
    }
    this.isLoadingWorkspace = true;
    setTimeout(() => window.location.reload(), 300);
  }

  onWorkspaceChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedWorkspaceId = value;
    const wsId = value === '' ? null : value;
    this.mandatWorkspace.activeWorkspaceUserId.set(wsId);
    if (wsId) {
      sessionStorage.setItem('activeWorkspace', wsId);
    } else {
      sessionStorage.removeItem('activeWorkspace');
    }
    this.isLoadingWorkspace = true;
    setTimeout(() => window.location.reload(), 300);
  }

  isConnect() {
    return localStorage.getItem('Compte');
  }

  getNom() {
    return localStorage.getItem('Nom');
  }

  getPrenom() {
    return localStorage.getItem('Prenom');
  }

  getInitial(): string {
    const source = this.getPrenom() || this.getNom() || '';
    return source.charAt(0).toUpperCase() || 'U';
  }

  onLogout() {
    sessionStorage.removeItem('activeWorkspace');
    localStorage.clear();
    this.route.navigateByUrl('/');
  }

  goToConnexion() {
    this.route.navigate(['/connexion']);
  }

  isRouteActive(route: string): boolean {
    const currentUrl = this.route.url;
    if (route === '/back-office') {
      return currentUrl === '/' || currentUrl === '/back-office';
    }
    return currentUrl === route;
  }

  /** Bouton "Admin" de la sidebar en surbrillance sur toutes les pages /admin/... */
  isAdminRouteActive(): boolean {
    return this.route.url.startsWith('/admin');
  }
}

