import { Injectable } from '@angular/core';
import { Observable, of, map, shareReplay, BehaviorSubject } from 'rxjs';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class CacheService {
  private readonly DEFAULT_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
  private memoryCache = new Map<string, CacheEntry<any>>();
  private ongoingRequests = new Map<string, Observable<any>>();

  /**
   * 💾 Sauvegarde dans localStorage avec gestion d'erreurs
   */
  private saveToLocalStorage(key: string, data: any, expiresAt: number): void {
    try {
      const cacheEntry: CacheEntry<any> = {
        data,
        timestamp: Date.now(),
        expiresAt
      };
      localStorage.setItem(key, JSON.stringify(cacheEntry));
    } catch (error) {
      console.warn('Erreur sauvegarde localStorage');
    }
  }

  /**
   * 📦 Récupère depuis localStorage avec validation
   */
  private getFromLocalStorage<T>(key: string): T | null {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;

      const cacheEntry: CacheEntry<T> = JSON.parse(cached);
      
      // Vérifier expiration
      if (Date.now() > cacheEntry.expiresAt) {
        localStorage.removeItem(key);
        return null;
      }

      return cacheEntry.data;
    } catch (error) {
      localStorage.removeItem(key);
      return null;
    }
  }

  /**
   * 🚀 Cache intelligent avec déduplication des requêtes
   */
  getCachedData<T>(
    key: string,
    dataLoader: () => Observable<T>,
    cacheDuration: number = this.DEFAULT_CACHE_DURATION
  ): Observable<T> {
    // 1. Vérifier cache mémoire
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry && Date.now() < memoryEntry.expiresAt) {
      return of(memoryEntry.data);
    }

    // 2. Vérifier localStorage
    const localStorageData = this.getFromLocalStorage<T>(key);
    if (localStorageData !== null) {
      // Mettre à jour le cache mémoire
      const expiresAt = Date.now() + cacheDuration;
      this.memoryCache.set(key, {
        data: localStorageData,
        timestamp: Date.now(),
        expiresAt
      });
      return of(localStorageData);
    }

    // 3. Vérifier si une requête est déjà en cours
    if (this.ongoingRequests.has(key)) {
      return this.ongoingRequests.get(key)!;
    }
    // 4. Charger les données et mettre en cache
    const request$ = dataLoader().pipe(
      map(data => {
        const expiresAt = Date.now() + cacheDuration;
        
        // Sauvegarder en mémoire
        this.memoryCache.set(key, {
          data,
          timestamp: Date.now(),
          expiresAt
        });
        
        // Sauvegarder dans localStorage
        this.saveToLocalStorage(key, data, expiresAt);
        
        // Supprimer de la liste des requêtes en cours
        this.ongoingRequests.delete(key);
        
        return data;
      }),
      shareReplay(1)
    );

    // Stocker la requête en cours
    this.ongoingRequests.set(key, request$);
    return request$;
  }

  /**
   * 🗑️ Vide le cache pour une clé spécifique
   */
  clearCache(key: string): void {
    this.memoryCache.delete(key);
    localStorage.removeItem(key);
    this.ongoingRequests.delete(key);
  }

  /**
   *  Vide tout le cache
   */
  clearAllCache(): void {
    this.memoryCache.clear();
    this.ongoingRequests.clear();
    
    // Vider localStorage (seulement les clés de cache de l'app)
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('appifield_')) {
        localStorage.removeItem(key);
      }
    });

  }

  /**
   * 📊 Statistiques du cache
   */
  getCacheStats(): {
    memoryEntries: number;
    ongoingRequests: number;
    localStorageKeys: number;
  } {
    const localStorageKeys = Object.keys(localStorage).filter(key => 
      key.startsWith('appifield_')
    ).length;

    return {
      memoryEntries: this.memoryCache.size,
      ongoingRequests: this.ongoingRequests.size,
      localStorageKeys
    };
  }
}