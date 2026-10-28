import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

interface FaqItem {
  id: string;
  question: string;
  category: string;
  answer: string;
}

@Component({
  selector: 'app-faq-liste-item',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './faq-liste-item.component.html',
  styleUrl: './faq-liste-item.component.scss'
})
export class FaqListeItemComponent {
  searchText: string = '';
  selectedCategory: string = 'all';
  
  faqItems: FaqItem[] = [
    {
      id: 'collapseOne',
      question: 'Je ne retrouve plus mon mot de passe.',      
      category: 'Mon compte',      
      answer: 'Sur la page de connexion, cliquez sur « Mot de passe oublié ? ». Vous pourrez ensuite mentionner l’adresse mail avec laquelle vous avez créé votre compte. Un e-mail vous permettant de réinitialiser votre mot de passe vous sera automatiquement envoyé.',
    },
    {
      id: 'collapseTwo',
      question: 'Je n\'ai pas de numéro de TVA',
      category: 'Mon compte',
      answer: 'Pas de soucis, vous pouvez laisser ce champ libre.'
    },
    {
      id: 'collapseThree',
      question: 'Je ne reçois pas le mail de confirmation',      
      category: 'Mon compte',      
      answer: 'Avez-vous pensé à regarder dans vos courriers indésirables ? Il n’est pas impossible que ce dernier soit arrivé là 🙂'
    },
    {
      id: 'collapseFour',
      question: 'Je n’arrive pas à encoder ou à localiser ma parcelle.',      
      category: 'Parcelles & zones de traitement',      
      answer: 'Après vous être rendu sur l’onglet « Parcelles & zones de traitement » et avoir cliqué sur le bouton « Ajouter » (situé en bas à droite), vous pourrez trouver différents outils mis à votre disposition afin de vous permettre de trouver vos parcelles.'
    },
    {
      id: 'collapseFive',
      question: 'Je n’arrive pas à importer mes données PAC',      
      category: 'Parcelles & zones de traitement',      
      answer: 'Assurez-vous que votre fichier respecte bien le format .gml.'
    },
     {
      id: 'collapseSixb',
      question: 'Je ne peux pas exporter ma déclaration PAC au format .gml',      
      category: 'Parcelles & zones de traitement',      
      answer: 'La fonctionnalité d’export au format .gml n\'est pas encore disponible pour tous les comptes. Elle le sera normalement d\'ici le mois d\'avril 2026'
    },
    {
      id: 'collapseSeven',
      question: 'Comment utiliser la fonction d’archivage ?',      
      category: 'Archives',      
      answer: 'Sélectionnez la culture que vous souhaitez archiver et cliquez sur le bouton "Archiver ma culture", il vous sera alors proposé de lui attribuer une collection spécifique et de l\'archiver.'
    },
    {
      id: 'collapseSevenc',
      question: 'Puis-je appliquer des traitements sur une culture archivée ?',      
      category: 'Archives',      
      answer: 'Non, lorsque vous archivez une culture, cette dernière reste sauvegardée dans votre registre, mais vous ne pourrez plus directement la modifier ou lui appliquer de nouveaux traitements. Si vous souhaitez modifier ou appliquer de nouveaux traitements sur une culture archivée, restaurez-la d\'abord.'
    },
    {
      id: 'collapseSevenf',
      question: 'Est-ce qu\'une culture archivée peut toujours être modifiée ?',      
      category: 'Archives',      
      answer: 'Non, lorsque vous archivez une culture, cette dernière reste sauvegardée dans votre registre, mais vous ne pourrez plus directement la modifier ou lui appliquer de nouveaux traitements. Si vous souhaitez modifier ou appliquer de nouveaux traitements sur une culture archivée, restaurez-la d\'abord.'
    },
    {
      id: 'collapseSevenb',
      question: 'Puis-je restaurer une culture archivée ?',      
      category: 'Archives',      
      answer: 'Vous pouvez facilement restaurer une culture archivée en vous rendant dans vos archives et en cliquant sur le bouton "Restaurer ma culture".'
    },
    {
      id: 'collapseEight',
      question: 'Certains de mes produits ont une quantité restante de produit négative.',      
      category: 'Inventaire',      
      answer: 'Lorsque vous appliquez un traitement, le (ou les) PPP utilisé(s) s’ajoute(nt) automatiquement à votre inventaire en prenant en compte la quantité utilisée dans ce dernier. Vu qu’initialement, aucun achat de produit n’a été mentionné, la quantité utilisée est donc soustraite à zéro (ce qui génère une quantité négative). Vous pouvez mentionner vos achats/entrées de PPP en cliquant le bouton "Ajouter".'
    },
    {
      id: 'collapseNine',
      question: 'Je ne trouve pas la catégorie phytoweb de ma culture',      
      category: 'Culture',      
      answer: 'Vous pourrez généralement retrouver la catégorie phytoweb de votre culture en recherchant simplement le nom de votre culture. Certaines cultures rentrant, cependant,dans des catégories plus spécifiques, nous travaillons actuellement sur une amélioration de ce menu d\'encodage.'
    },
    {
      id: 'collapseTen',
      question: 'Le bouton "S\'inscrire" ne s\'active pas alors que j\'ai rempli tous les champs requis.',      
      category: 'Inscription',      
      answer: 'Pensez à vérifier si le mot de passe que vous avez choisi respecte bien les critères de sécurité (au moins 8 caractères, un chiffre et deux caractères spéciaux).'
    },
    {
      id: 'collapseTenB',
      question: 'Qui de l’agriculteur ou de l’entrepreneur doit remplir et conserver ce registre ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `L'entrepreneur agricole (et tout autre utilisateur professionnel) qui réalise des pulvérisations doit tenir son propre registre lié à ses opérations. Devront y figurer au 1er janvier 2026 :
      - Type d’utilisation (traitement de surfaces, d’espaces fermés ou de semences) ;
      - Produit utilisé (nom du produit et numéro d’autorisation) ;
      - Moment d’application du produit (date et, le cas échéant, heure de début de l’utilisation) ;
      - Définition de la culture traitée selon Phytoweb et, le cas échéant, le stade phénologique BBCH ;
      - Localisation de la parcelle ou de l’installation (serre, hangar...) ;
      - Dose utilisée ;
      - Taille de la surface ou quantité de l’unité traitée (en ha, l/ha, m³, m² ou nombre de semences).
      
      Si ces données ne sont pas entièrement déterminées ou connues au préalable, elles sont ensuite transmises dans les 7 jours (30 jours au niveau fédéral) au responsable de la culture. Le responsable de la culture est celui à qui appartient la culture, autrement dit :
      - Le propriétaire de la récolte ;
      - Celui qui utilise ou vend le produit de la culture ;
      - Le responsable des travaux agricoles (PPP ou autres, qu'il effectue lui-même ou les sous-traite) ;
      - Pas forcément le propriétaire des terres, mais celui qui est propriétaire de la culture (et dès lors, qui décide des opérations qui y sont liées).
      
      Pour vous aider à le déterminer, veuillez consulter la <a href="https://favv-afsca.be/fr/outils-specifiques-dautocontrole-par-secteur-dactivite/G-040" target="_blank" rel="noopener noreferrer">FAQ du guide pour la production primaire de l'AFSCA</a>, pages 16 à 20 (Généralités - productions végétales). La question 2 reprend les différents cas de figure pour la responsabilité des registres en fonction des contrats et des opérations.
      
      Le responsable de la culture doit donc tenir le registre lié aux opérations réalisées sur la culture. Doivent également figurer dans ce registre* :
      - Précédent cultural de la culture ;
      - Variété emblavée ;
      - Ennemi visé lors d'un traitement PPP (Attention, vigilance à demander cette information si la pulvérisation est déterminée par un tiers). 
      
      <i>* Cette exigence provient de la <a href="https://wallex.wallonie.be/eli/arrete/2017/01/26/2017011111/" target="_blank" rel="noopener noreferrer">législation wallonne relative à la lutte intégrée contre les ennemis des cultures</a> et concernent les producteurs de végétaux dont les parcelles sont déclarées (dans la déclaration de superficie) dans le cadre de la conditionnalité de la PAC.<\i>
      
      Bien que ces exigences supplémentaires ne fassent pas partie des contrôles de l’<a href="https://favv-afsca.be/fr" target="_blank" rel="noopener noreferrer">AFSCA</a>, elles peuvent être vérifiées par les agents wallons du Département de la Police et des Contrôles. Il est fortement conseillé de regrouper toutes ces informations au sein du même registre.

      Le délai d'enregistrement de la pulvérisation est de 7 jours (d'où la transmission des données au client par l'entrepreneur dans les 7 jours). 
      `
    },
    {
      id: 'collapseTenC',
      question: 'Quelle est la durée de conservation du registre ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `- Pour les producteurs de végétaux (alimentaires ou autres), la durée est de 6 ans. 
      - Pour les entrepreneurs agricoles, la durée est de 5 ans.
      - Pour tous les autres utilisateurs professionnels (entrepreneurs de parcs et jardins, gestionnaires d’espaces verts, etc.) la durée est de 3 ans.
      `
    },
    {
      id: 'collapseTenD',
      question: 'Quel est le délai de transmission ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `Lors de la sous-traitance de l'activité de pulvérisation/traitement phytosanitaire par entrepreneur, toutes les données du traitement (date, PPP, culture, dose…) devront être communiquées par écrit ou électroniquement à l’agriculteur ou à l’horticulteur concerné afin qu’il complète son propre registre d’utilisation endéans les 7 jours suivant le traitement.
      `
    },
    {
      id: 'collapseTenE',
      question: 'Quel est le délai d’enregistrement ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `Le traitement doit toujours être encodé endéans les 7 jours suivant le traitement, que le format soit papier ou électronique.
      `
    },
    {
      id: 'collapseTenF',
      question: 'Faut-il mentionner l’ennemi visé lors du traitement ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `Oui, c’est une donnée nécessaire à faire figurer dans le registre*.

      Bien que ces exigences supplémentaires ne fassent pas partie des contrôles de l’<a href="https://favv-afsca.be/fr" target="_blank" rel="noopener noreferrer">AFSCA</a>, elles peuvent être vérifiées par les agents wallons du Département de la Police et des Contrôles. Il est fortement conseillé de regrouper toutes ces informations au sein du même registre.

      * Cette exigence provient de la <a href="https://wallex.wallonie.be/eli/arrete/2017/01/26/2017011111/" target="_blank" rel="noopener noreferrer">législation wallonne relative à la lutte intégrée contre les ennemis des cultures</a> et concernent les producteurs de végétaux dont les parcelles sont déclarées (dans la déclaration de superficie) dans le cadre de la conditionnalité de la PAC. Les autres utilisateurs de PPP (gestionnaires d’espaces verts, entrepreneurs de parcs et jardins, etc.) ne sont pas concernés par cette mesure. 
      `
    },
    {
      id: 'collapseTenG',
      question: 'Faut-il mentionner le précédent cultural ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `Si la parcelle est intégrée d’une rotation culturale, le précédent cultural* est à renseigner dans le registre.

      Bien que ces exigences supplémentaires ne fassent pas partie des contrôles de l’<a href="https://favv-afsca.be/fr" target="_blank" rel="noopener noreferrer">AFSCA</a>, elles peuvent être vérifiées par les agents wallons du Département de la Police et des Contrôles. Il est fortement conseillé de regrouper toutes ces informations au sein du même registre. 

      *Cette exigence provient de la <a href="https://wallex.wallonie.be/eli/arrete/2017/01/26/2017011111/" target="_blank" rel="noopener noreferrer">législation wallonne relative à la lutte intégrée contre les ennemis des cultures</a> et concernent les producteurs de végétaux dont les parcelles sont déclarées (dans la déclaration de superficie) dans le cadre de la conditionnalité de la PAC.
      `
    },
    {
      id: 'collapseTenH',
      question: 'Comment encoder la dose et la surface/quantité traitée ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `La dose correspond à la quantité en kilogrammes/litres de produit appliqué (par hectare, volume, m² ou nombre de semences).

      La taille de la surface (= la superficie) ou la quantité de l’unité traitée est renseignée avec l’unité correspondante en ha, l/ha, m³, m² ou nombre de semences.
      `
    },
    {
      id: 'collapseTenI',
      question: 'Comment localiser la parcelle ou l’installation ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `Cela correspond à la référence géospatialisée de la parcelle ou de l'installation (serre, hangar, etc.) où le PPP est utilisé, telle qu'indiquée dans la demande unique se rapportant à l'année de campagne et au numéro de parcelle (SIGEC). A défaut, le numéro de cadastre, l'adresse ou les coordonnées xy peuvent être utilisés.
      `
    },
    {
      id: 'collapseTenJ',
      question: 'Comment déterminer le stade de développement de la culture ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `Le stade de la culture ne doit être repris dans le registre que si l’autorisation du produit stipule un stade d’application particulier tel que « pré-émergence », « au moment de la plantation » ou sur base de l’échelle de développement BBCH de la culture. 

      Lorsque l’autorisation du produit mentionne un période couvrant plusieurs stades telle que « BBCH 13-39 », le registre reprendra, dans la mesure du possible, le stade représentatif de la culture au moment du traitement, par exemple « BBCH 15 » ou « stade 5 feuilles ».

      Le <a href="https://www.health.belgium.be/fr" target="_blank" rel="noopener noreferrer">SPF Santé Publique</a> publie et met à jour sur <a href="https://fytoweb.be/fr" target="_blank" rel="noopener noreferrer">Phytoweb</a> les tables BBCH correspondant aux cultures autorisées ici. Des simplifications d’encodage sont susceptibles d’être mises en place d’ici 2026.
      `
    },
    {
      id: 'collapseTenK',
      question: 'Faut-il mentionner la variété dans le registre ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `Si la variété* est identifiée, c’est une donnée nécessaire à faire figurer dans le registre.

      <a href="https://agriculture.wallonie.be/home/productions-agricoles/qualite/modes-de-productions-specifiques/productions-integrees.html#:~:text=La%20lutte%20int%C3%A9gr%C3%A9e%20%2D%20ou%20IPM,engendrent%20sous%20un%20seuil%20acceptable" target="_blank" rel="noopener noreferrer">D’après le cahier des charges contre les ennemis des cultures (Annexe 1. Principe I : 1.3.1.1)</a> : si les informations relatives aux caractéristiques des variétés et des cultivars commerciaux cultivés (notamment en ce qui concerne la sensibilité et la résistance/tolérance aux maladies) sont disponibles, le choix variétal doit prendre en compte la durabilité, le contexte sanitaire et la résistance, dans le cadre de la réalité commerciale.
      
      Bien que ces exigences supplémentaires ne fassent pas partie des contrôles de l’<a href="https://favv-afsca.be/fr" target="_blank" rel="noopener noreferrer">AFSCA</a>, elles peuvent être vérifiées par les agents wallons du Département de la Police et des Contrôles. Il est fortement conseillé de regrouper toutes ces informations au sein du même registre. 
      
      * Cette exigence provient de la <a href="https://wallex.wallonie.be/eli/arrete/2017/01/26/2017011111/" target="_blank" rel="noopener noreferrer">législation wallonne relative à la lutte intégrée contre les ennemis des cultures</a> et concernent les producteurs de végétaux dont les parcelles sont déclarées (dans la déclaration de superficie) dans le cadre de la conditionnalité de la PAC.
      `
    },
    {
      id: 'collapseTenL',
      question: 'Comment définir la culture ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `La culture doit être enregistrée dans le registre en utilisant la dénomination officielle figurant sur <a href="https://fytoweb.be/fr" target="_blank" rel="noopener noreferrer">Phytoweb</a>, conforme à celle reprise sur l’acte autorisation ou sur l’étiquette du produit (Ex : froment d’hiver).

      Le code OEPP correspondant est automatiquement associé à cette dénomination via la nomenclature <a href="https://fytoweb.be/fr" target="_blank" rel="noopener noreferrer">Phytoweb</a>, validée par le <a href="https://www.health.belgium.be/fr" target="_blank" rel="noopener noreferrer">SPF Santé publique</a>. Il n’incombe pas à l’utilisateur de déterminer le code OEPP ni de le mentionner dans le registre.
      `
    },
    {
      id: 'collapseTenM',
      question: 'Quel est le moment d’application ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `La date du traitement et, le cas échéant, l’heure de début d’utilisation, c’est-à-dire :

      Par exemple, lorsque l’utilisation est limitée à des heures spécifiques de la journée ou lorsque le moment de l’utilisation est pertinent dans le contexte de l’utilisation particulière.

      En fonction (1) du PPP et de ses conditions d'application, ainsi que (2) des règlementations encadrant les pulvérisations.

      1. Dans l'acte d'autorisation, la classification et étiquetage, où figurent notamment les mentions de danger et conseils de prudence susceptibles d’indiquer ou d'induire un <a href="https://www.corder.be/fr/crputilisateurs-professionnels-agricoles-et-horticoles/sante#:~:text=D%C3%A9lai%20de%20rentr%C3%A9e%20sur%20la%20zone%20trait%C3%A9e,-Texte&text=L%C3%A0%20o%C3%B9%20il%20est%20encore,est%20obligatoire%20de%20le%20respecter." target="_blank" rel="noopener noreferrer">délai d'entrée sur la zone traitée</a>, notamment les PPP nécessitant une Phytolicence Ps. Les conditions d’application peuvent préciser également un délai de ré-entrée.

      Certaines <a href="https://corder.be/fr/crputilisateurs-professionnels-agricoles-et-horticoles/environnement#paragraph-89" target="_blank" rel="noopener noreferrer">mesures de protection de l'environnement</a> imposent des restrictions horaires. Par exemple, pour les insecticides comportant la mention SPe8 (danger pour les abeilles et autres insectes pollinisateurs) : [...]. Le produit doit être appliqué tôt le matin ou tard le soir.

      2. En Région wallonne, l’heure de début de traitement doit être mentionnée lorsque des restrictions liées aux heures de fréquentation s’appliquent :
      - Les traitements à moins de 50 mètres des <a href="https://www.corder.be/fr/crputilisateurs-professionnels-agricoles-et-horticoles/sante#paragraph-96" target="_blank" rel="noopener noreferrer">espaces et infrastructures d'accueil de l'enfance</a> (écoles, crèches, internats...),
      - Les quelques exceptions de <a href="https://www.corder.be/fr/crpautres-utilisateurs-professionnels/utilisation-et-stockage#paragraph-46" target="_blank" rel="noopener noreferrer">traitements en espaces privés fréquentés par le public</a> où une durée d'éviction doit être indiquée.
      `
    },
    {
      id: 'collapseTenN',
      question: 'Que représente le type d’utilisation ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `Le type d’utilisation correspond soit à :
      - Traitement de surfaces (ex. : pulvérisation en champs) ;
      - Traitement d’espaces fermés (ex. : désinfection de locaux) ;
      - Traitement de semences.
      `
    },
    {
      id: 'collapseTenK',
      question: 'Quel est le format du registre ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `Par "format électronique", le législateur entend un format "lisible par machine" selon la Directive (UE) 2019/1024. Par exemple : un format Excel, Word ou PDF consultable suffit, mais pas de photo ni de scan.

      Plusieurs solutions numériques sont ou disponibles pour répondre à ces nouvelles exigences. Les utilisateurs sont libres de choisir l’outil le plus adapté à leur activité, pour autant qu’ils respectent les obligations légales.
      `
    },
    {
      id: 'collapseTenL',
      question: 'Quelles informations doivent figurer dans le registre ?',      
      category: 'Législation - Nouveautés 2026',      
      answer: `Tout utilisateur qui emploie des PPP dans le cadre de ses activités professionnels doit tenir dans son propre registre ces informations liées à ses opérations :
      - La référence géospatialisée de la parcelle/de l'installation,
      - Le nom de la culture conformément à l'appellation sur Phytoweb,
      - S'il est indiqué : le stade de développement de la culture, sous l'échelle phénologique BBCH ou autre,
      - Le type d'utilisation,
      - Le nom commercial du PPP,
      - Le numéro d'autorisation du PPP,
      - La date d'application/traitement/pulvérisation,
      - Si pertinente : l'heure d'application/traitement/pulvérisation,
      - La dose appliquée,
      - La superficie (ou quantité appliquée) avec les unités correspondantes.

      Pour rappel, il est également demandé de joindre à ce registre les résultats d'analyses d'échantillons prélevés sur des végétaux ou d'autres échantillons, revêtant une importance pour la santé publique, et/ou d'indiquer le présence d'organismes nuisibles ou de maladies pouvant compromettre la sécurité des produits d'origine végétale. 
      
      Pour les producteurs de végétaux wallons*, doivent également figurer dans ce registre :
      - Le précédent cultural de la culture,
      - La variété emblavée,
      - L’ennemi visé lors du traitement.

      * Cette exigence provient de la <a href="https://wallex.wallonie.be/eli/arrete/2017/01/26/2017011111/" target="_blank" rel="noopener noreferrer">législation wallonne relative à la lutte intégrée contre les ennemis des cultures</a> et concernent les producteurs de végétaux dont les parcelles sont déclarées (dans la déclaration de superficie) dans le cadre de la conditionnalité de la PAC. Les autres utilisateurs de PPP (gestionnaires d’espaces verts, entrepreneurs de parcs et jardins, etc.) ne sont pas concernés par ces mesures.
      
      Bien que ces exigences supplémentaires ne fassent pas partie des contrôles de l’<a href="https://favv-afsca.be/fr" target="_blank" rel="noopener noreferrer">AFSCA</a>, elles peuvent être vérifiées par les agents wallons du Département de la Police et des Contrôles. Il est fortement conseillé de regrouper toutes ces informations au sein du même registre. 
      `
    }
  ];

  get categories(): string[] {
    const uniqueCategories = [...new Set(this.faqItems.map(item => item.category))];
    return uniqueCategories.sort();
  }

  get filteredItems(): FaqItem[] {
    let filtered = this.faqItems;
    
    // Filtre par catégorie
    if (this.selectedCategory !== 'all') {
      filtered = filtered.filter(item => item.category === this.selectedCategory);
    }
    
    // Filtre par recherche
    if (this.searchText.trim()) {
      const searchLower = this.searchText.toLowerCase();
      filtered = filtered.filter(item => 
        item.question.toLowerCase().includes(searchLower) ||
        item.answer.toLowerCase().includes(searchLower)
      );
    }
    
    return filtered;
  }

  selectCategory(category: string): void {
    this.selectedCategory = category;
  }
}

