import { Directive, Input, TemplateRef, ViewContainerRef, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

/**
 * 🚀 Directive de virtualisation pour optimiser l'affichage de longues listes
 * Affiche seulement les éléments visibles pour améliorer les performances
 */
@Directive({
  selector: '[appVirtualFor]',
  standalone: true
})
export class VirtualForDirective implements OnInit, OnDestroy {
  @Input() appVirtualForOf: any[] = [];
  @Input() appVirtualForTrackBy?: (index: number, item: any) => any;
  @Input() appVirtualForTemplate!: TemplateRef<any>;
  @Input() appVirtualForItemHeight: number = 80; // Hauteur approximative d'un élément
  @Input() appVirtualForViewportHeight: number = 400; // Hauteur de la zone visible

  private destroy$ = new Subject<void>();
  private visibleStartIndex = 0;
  private visibleEndIndex = 10;
  private renderedItems = new Map<any, any>();

  constructor(
    private templateRef: TemplateRef<any>,
    private viewContainer: ViewContainerRef
  ) {}

  ngOnInit() {
    this.updateVisibleItems();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private updateVisibleItems() {
    // Calculer combien d'éléments peuvent être visibles
    const itemsPerView = Math.ceil(this.appVirtualForViewportHeight / this.appVirtualForItemHeight);
    this.visibleEndIndex = Math.min(this.visibleStartIndex + itemsPerView + 2, this.appVirtualForOf.length);

    // Nettoyer les vues existantes
    this.viewContainer.clear();

    // Créer les vues pour les éléments visibles
    for (let i = this.visibleStartIndex; i < this.visibleEndIndex; i++) {
      const item = this.appVirtualForOf[i];
      if (item) {
        const context = {
          $implicit: item,
          index: i
        };
        this.viewContainer.createEmbeddedView(this.templateRef, context);
      }
    }
  }

  onScroll(event: Event) {
    const element = event.target as HTMLElement;
    const scrollTop = element.scrollTop;
    
    // Calculer le nouvel index de début basé sur la position de défilement
    const newStartIndex = Math.floor(scrollTop / this.appVirtualForItemHeight);
    
    if (newStartIndex !== this.visibleStartIndex) {
      this.visibleStartIndex = newStartIndex;
      this.updateVisibleItems();
    }
  }
}
