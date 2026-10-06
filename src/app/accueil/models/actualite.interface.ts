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
  private rssUrl = 'https://corsproxy.io/?' + encodeURIComponent('https://rss.app/feeds/EgeJhi2fh1I75wSJ.xml');

  constructor(private http: HttpClient) {}

  getActualites(max: number = 4): Observable<ActualiteRss[]> {
    return this.http.get(this.rssUrl, { responseType: 'text' }).pipe(
      map(xml => this.parseRss(xml, max))
    );
  }

  private parseRss(xml: string, max: number): ActualiteRss[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const items = Array.from(doc.getElementsByTagName('item')).slice(0, max);
    return items.map(item => {
      // Helper to extract CDATA or text
      const getText = (tag: string) => {
        const el = item.getElementsByTagName(tag)[0];
        if (!el) return '';
        const cdata = el.childNodes[0];
        if (cdata && cdata.nodeType === 4) return cdata.nodeValue || '';
        return el.textContent || '';
      };
      const title = getText('title');
      const link = getText('link');
      const pubDate = getText('pubDate');
      let description = getText('description');
      // Fallback: if no description, try dc:creator or empty
      if (!description) description = getText('dc:creator');
      let image = '';
      // Try to extract image from media:content (namespace)
      const mediaEls = item.getElementsByTagName('media:content');
      if (mediaEls.length > 0) {
        image = mediaEls[0].getAttribute('url') || '';
      } else {
        // Try to extract image from description HTML
        const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/);
        if (imgMatch) image = imgMatch[1];
      }
      // Remove HTML tags from description for preview
      description = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return { title, link, pubDate, description, image };
    });
  }
}