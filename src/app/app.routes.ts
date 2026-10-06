import { Routes } from '@angular/router';
import { AuthGuard } from './core/auth/guards/auth.guard';
import { RedirectIfAuthenticatedGuard } from './core/auth/guards/redirect-if-authenticated.guard';
import { AdminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
    { path:'', loadChildren: ()=> import('./accueil/accueil.module').then(m => m.AccueilModule), canActivate: [RedirectIfAuthenticatedGuard] },
    { path:'connexion', loadChildren:()=>import('./core/auth/auth.module').then(m=>m.AuthModule)},
    { path:'erreur', loadChildren:()=>import('./erreur/erreur.module').then(m => m.ErreurModule) },
    { path:'reglage', loadChildren:()=>import('./reglage/reglage.module').then(m => m.ReglageModule), canActivate: [AuthGuard] },
    { path:'compte', loadChildren:()=>import('./compte/compte.module').then(m => m.CompteModule), canActivate: [AuthGuard] },
    { path:'creation-compte', loadChildren:()=>import('./creation-compte/creation-compte.module').then(m=> m.CreationCompteModule)},
    { path:'mes-preferences', loadChildren:()=>import('./mes-preferences/mes-preferences.module').then(m=>m.MesPreferencesModule), canActivate: [AuthGuard]},
    { path:'gestion-des-operations', loadChildren:()=>import('./gestion-des-operations/gestion-des-operations.module').then(m=>m.GestionDesOperationsModule), canActivate: [AuthGuard]},
    { path:'back-office', data: { animIndex: 0 }, loadChildren:()=>import('./back-office/back-office.module').then(m=>m.BackOfficeModule), canActivate: [AuthGuard]},
    { path:'back-office-itsme', loadChildren:()=>import('./creation-compte-admin/creation-compte-admin.module').then(m=>m.CreationCompteAdminModule), canActivate: [AuthGuard]},
    { path:'parcelles', data: { animIndex: 1 }, loadChildren:()=>import('./parcelles/parcelles.module').then(m=>m.ParcellesModule), canActivate: [AuthGuard]},
    { path:'registre', data: { animIndex: 2 }, loadChildren:()=>import('./registre/registre.module').then(m=>m.RegistreModule), canActivate: [AuthGuard]},
    { path:'inventaire', data: { animIndex: 3 }, loadChildren:()=>import('./inventaire/inventaire.module').then(m=>m.InventaireModule), canActivate: [AuthGuard]},
    { path:'admin/formations', loadComponent: () => import('./admin/formations/formations.component').then(m => m.FormationsComponent), canActivate: [AuthGuard, AdminGuard]},
    { path:'admin/phytoweb-categories', loadComponent: () => import('./admin/phytoweb-categories/phytoweb-categories.component').then(m => m.PhytowebCategoriesComponent), canActivate: [AuthGuard, AdminGuard]},
    { path:'faq', loadChildren:()=>import('./faq/faq.module').then(m => m.FaqModule)},
    { path:'cgu', loadComponent: () => import('./cgu/cgu.component').then(m => m.CguComponent) },
    { path:'sso', loadComponent: () => import('./core/auth/components/sso/sso.component').then(m => m.SsoComponent) },
    { path:'', redirectTo:'', pathMatch:'full' },
    { path:'**', redirectTo:'erreur', pathMatch:'full' }
];
