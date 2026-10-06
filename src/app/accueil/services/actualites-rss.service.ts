
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

export interface ActualiteRss {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  image?: string;
}

@Injectable({ providedIn: 'root' })
export class ActualitesRssService {
  private rssUrl = '/rss/walakis_rss.php';

  constructor(private http: HttpClient) {}

  getActualites(max: number = 4): Observable<ActualiteRss[]> {
    return this.http.get(this.rssUrl, { responseType: 'text' }).pipe(
      map(xml => {
        // Nettoyer le XML avant le parsing pour éviter les erreurs d'entités
        const cleanedXml = this.cleanXmlEntities(xml);
        return this.parseRss(cleanedXml, max);
      })
    );
  }

  private cleanXmlEntities(xml: string): string {
    try {
      // Remplacer les entités HTML mal formées courantes
      return xml
        .replace(/&(?![a-zA-Z0-9#]{1,7};)/g, '&amp;') // Remplacer & isolés
        .replace(/&#039;/g, "'") // Apostrophes
        .replace(/&nbsp;/g, ' ') // Espaces insécables
        .replace(/&ldquo;/g, '"') // Guillemets
        .replace(/&rdquo;/g, '"')
        .replace(/&lsquo;/g, "'")
        .replace(/&rsquo;/g, "'")
        .replace(/&hellip;/g, '...')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–');
    } catch (error) {
      return xml;
    }
  }

  private parseRss(xml: string, max: number): ActualiteRss[] {
    try {
      const parser = new DOMParser();
      let doc = parser.parseFromString(xml, 'application/xml');
      
      // Vérifier s'il y a des erreurs de parsing XML
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        
        // Fallback: essayer de parser comme HTML
        doc = parser.parseFromString(xml, 'text/html');
        
        // Si ça échoue encore, essayer de nettoyer davantage le XML
        if (!doc.getElementsByTagName('item').length) {
          const furtherCleanedXml = this.furtherCleanXml(xml);
          doc = parser.parseFromString(furtherCleanedXml, 'application/xml');
        }
      }
      
      const items = Array.from(doc.getElementsByTagName('item')).slice(0, max);
      
      if (items.length === 0) {
        return [];
      }
      
      return items.map(item => {
        // Helper to extract CDATA or text
        const getText = (tag: string) => {
          const el = item.getElementsByTagName(tag)[0];
          if (!el) return '';
          const cdata = el.childNodes[0];
          if (cdata && cdata.nodeType === 4) return cdata.nodeValue || '';
          return el.textContent || '';
        };
        
        const title = getText('title').trim();
        const link = getText('link').trim();
        const pubDate = getText('pubDate').trim();
        let description = getText('description').trim();
        
        // Fallback pour la description si elle est vide
        if (!description || description === '') {
          description = 'Cliquez pour lire l\'article complet';
        }
        
        let image = '';
        
        // Essayer d'extraire l'image depuis l'élément enclosure
        const enclosureEls = item.getElementsByTagName('enclosure');
        if (enclosureEls.length > 0) {
          const enclosureEl = enclosureEls[0];
          const type = enclosureEl.getAttribute('type') || '';
          // Vérifier si c'est un type d'image
          if (type.startsWith('image/')) {
            image = enclosureEl.getAttribute('url') || '';
          }
        }
        
        // Fallback: essayer d'extraire l'image depuis media:content
        if (!image) {
          const mediaEls = item.getElementsByTagName('media:content');
          if (mediaEls.length > 0) {
            image = mediaEls[0].getAttribute('url') || '';
          } else {
            // Essayer d'extraire l'image depuis le HTML de la description
            const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/);
            if (imgMatch) {
              image = imgMatch[1];
            }
          }
        }
        
        // Nettoyer la description des balises HTML
        description = description
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // Limiter la longueur de la description
        if (description.length > 150) {
          description = description.substring(0, 147) + '...';
        }
        
        return { 
          title: title || 'Titre non disponible', 
          link: link || '#', 
          pubDate: pubDate || new Date().toISOString(), 
          description, 
          image 
        };
      }).filter(item => item.title !== 'Titre non disponible' && item.link !== '#');
      
    } catch (error) {
      return [];
    }
  }

  private furtherCleanXml(xml: string): string {
    try {
      return xml
        // Supprimer les caractères de contrôle problématiques
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        // Encoder les & qui ne sont pas des entités valides
        .replace(/&(?![a-zA-Z0-9#]{1,10};)/g, '&amp;')
        // Corriger les entités courantes mal formées
        .replace(/&([a-zA-Z0-9]+)(?![;])/g, '&$1;')
        // Supprimer les attributs mal formés dans les balises
        .replace(/<([^>]*?)=([^"'\s>]*?)([^>]*?)>/g, '<$1="$2"$3>')
        // S'assurer que les balises auto-fermantes sont correctes
        .replace(/<(img|br|hr|input|meta|link)([^>]*?)(?<!\/)>/gi, '<$1$2/>');
    } catch (error) {
      return xml;
    }
  }
}
