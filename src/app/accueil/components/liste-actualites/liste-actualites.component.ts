import { Component, OnInit } from '@angular/core';
import { ActualitesRssService, ActualiteRss } from '../../services/actualites-rss.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-liste-actualites',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './liste-actualites.component.html',
  styleUrl: './liste-actualites.component.scss'
})
export class ListeActualitesComponent implements OnInit {
  actualites: ActualiteRss[] = [];
  isLoading = true;
  error = '';

  constructor(private actualitesRssService: ActualitesRssService) {}

  ngOnInit() {
    this.actualitesRssService.getActualites(4).subscribe({
      next: (articles) => {
        this.actualites = articles;
        this.isLoading = false;
        
        if (articles.length === 0) {
          console.warn('Aucun article trouvé dans le flux RSS');
        }
      },
      error: (err) => {
        this.error = 'Impossible de charger les actualités. Veuillez réessayer plus tard.';
        this.isLoading = false;
      }
    });
  }
}