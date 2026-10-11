# Rappel Avenir Eco

Page mobile « Me faire rappeler » accessible par QR code, pour les moments où le conseiller n'est pas sur le stand. Chaque demande est enregistrée dans un Google Sheet, le conseiller reçoit un e-mail complet et le contact du partenaire (Avenir Eco) est prévenu quand le lead vient de son stand.

Tout tourne dans Google Apps Script : gratuit, sans hébergeur ni nom de domaine. Les e-mails partent depuis le compte Google qui déploie le script.

## Fonctionnement

- `<url de l'application>?src=avenir-eco` : le paramètre `src` identifie l'origine du lead. Une source qui commence par `avenir-eco` (par exemple `avenir-eco-rennes`) déclenche l'e-mail au partenaire. Sans `src`, la source est `direct` et seul le conseiller est prévenu.
- Sur un QR du partenaire, la page affiche « En partenariat avec » et son logo, cite son nom dans le texte d'introduction et dans la phrase de consentement. Sur un accès direct ou une autre source, rien n'est affiché à son sujet. Le logo est intégré à la page (fichier `Logo.gs`), donc il ne dépend d'aucun site externe. Pour le remplacer par une image en ligne, ajoutez la propriété `AVENIR_ECO_LOGO_URL` (https uniquement) ; si cette image ne charge pas, le nom s'affiche en texte.
- Le partenaire reçoit par défaut le prénom, le créneau et l'heure, sans téléphone ni e-mail du client (propriété `PARTNER_SHARE_CONTACT` pour changer).
- Un lead est écrit dans le Sheet avant l'envoi des e-mails. Le client voit un succès si le lead est enregistré ou si l'e-mail au conseiller est parti. Les colonnes « Mail conseiller » et « Mail partenaire » du Sheet indiquent `sent`, `failed` ou `no-address`.
- Les leads de plus de 12 mois sont supprimés chaque nuit, comme annoncé aux clients.

## E-mails

Chaque demande envoie deux e-mails HTML (avec version texte) :

- **Au conseiller** (nom d'expéditeur « Octopus Rappel ») : objet « 🔥 Nouveau lead via Avenir Eco · Julie · cet après-midi », créneau à rappeler en évidence, numéro cliquable, boutons Appeler, SMS prérempli et Écrire, consentement horodaté.
- **Au contact du partenaire** (nom d'expéditeur « Allan Fix · Octopus Energy ») : version claire aux couleurs du partenaire, prénom et créneau seulement, avec un bouton pour appeler le conseiller.

Les images (mascotte, logo « octopus energy », logo du partenaire) sont jointes en ligne : Gmail n'affiche pas les images « data: ». Mascotte et logo texte sont dans `OctopusAssets.gs`, un fichier **facultatif et non versionné** (marque Octopus) : sans lui, les e-mails s'affichent sans mascotte et avec « Octopus Energy » en texte.

**Photo de profil** : l'avatar d'un e-mail dans Gmail est la photo du compte Google d'envoi, pas du code. Pour y afficher la mascotte, utilisez un compte Google dédié au service et mettez-y la mascotte comme photo de profil. Gmail affiche en général cet avatar ; Outlook et Apple Mail montrent souvent une initiale.

## Conseiller Avenir Eco cité par le client

Sur les QR Avenir Eco, un choix facultatif « Un conseiller Avenir Eco vous en a parlé ? » propose les prénoms de la liste, « Un autre conseiller » et « Non / je ne sais plus » (par défaut). Le prénom choisi apparaît dans le Sheet (colonne « Conseiller cité »), dans votre e-mail (« A échangé avec ») et dans celui du partenaire (« Conseiller cité »). Rien n'est affiché sur un accès direct.

La liste par défaut est Nicolas, Thierry, Julien. Pour la changer sans toucher au code, ajoutez la propriété du script `AVENIR_ECO_REPS` (prénoms séparés par des virgules, 8 au maximum). Le serveur n'accepte que ces prénoms : toute autre valeur est ignorée.

Si `setup` est relancé sur un Sheet créé avant cette fonction, il ajoute la colonne manquante sans perdre les leads.

## Mise en ligne, pas à pas

Les écrans de Google changent parfois de libellé : suivez l'esprit des étapes.

1. Avec le compte Google qui enverra les e-mails, ouvrez <https://script.google.com> et créez un projet.
2. Dans l'éditeur, remplacez le contenu de `Code.gs` par celui de `apps-script/Code.gs`.
3. Créez trois fichiers HTML nommés exactement `index`, `style` et `app` (bouton `+`, puis HTML) et collez-y `apps-script/index.html`, `style.html` et `app.html`. Créez aussi un fichier **Script** (bouton `+`, puis Script) nommé `Logo` et collez-y `apps-script/Logo.gs`. Facultatif : un fichier Script `OctopusAssets` (mascotte et logo texte pour les e-mails, fourni à part).
4. Dans « Paramètres du projet » (la roue dentée), cochez « Afficher le fichier manifeste appsscript.json dans l'éditeur », puis collez-y `apps-script/appsscript.json`.
5. Toujours dans « Paramètres du projet », section « Propriétés du script », ajoutez :
   - `OWNER_EMAIL` : votre adresse de réception des leads ;
   - `AVENIR_ECO_EMAIL` : l'adresse du contact Avenir Eco (plusieurs possibles, séparées par des virgules) ;
   - facultatif : `AVENIR_ECO_LOGO_URL` pour remplacer le logo intégré par une image en ligne (https).
6. Choisissez la fonction `setup` dans la barre d'outils et cliquez sur « Exécuter ». Google demande des autorisations : l'écran « Google n'a pas validé cette application » est normal pour votre propre script (Paramètres avancés, puis continuer). Le journal affiche l'adresse du Google Sheet créé.
7. Exécutez `sendTestEmails`. Vérifiez la réception chez vous **et** auprès du contact Avenir Eco, y compris dans ses courriers indésirables.
8. Exécutez `installPurgeTrigger` (une seule fois).
9. « Déployer » > « Nouveau déploiement » > type « Application Web » > exécuter en tant que « Moi » > accès « Tout le monde » > Déployer. Copiez l'URL qui se termine par `/exec`.
10. Testez sur un vrai iPhone et un vrai Android, en 4G : ouvrez l'URL terminée par `?src=avenir-eco` (sans ce paramètre, la page n'affiche ni logo ni mention d'Avenir Eco), envoyez une demande avec votre numéro, puis vérifiez le Sheet, les deux e-mails, et les boutons Appeler, SMS, E-mail et Ajouter le contact.

### Modifier l'application plus tard

« Déployer » > « Gérer les déploiements » > crayon > version « Nouvelle version » > Déployer. L'URL reste la même.

Ne choisissez jamais « Nouveau déploiement » pour une simple modification : il crée une autre URL et les QR codes déjà imprimés cesseraient de fonctionner.

## QR codes

```bash
npm install
node scripts/make-qr.js "https://script.google.com/macros/s/VOTRE_ID/exec" avenir-eco
```

Le script écrit `qr/<source>.svg` (à donner à l'imprimeur) et `qr/<source>.png`. Il refuse les URL en `http://` et les URL de test en `/dev`.

Pour l'impression :

- QR noir sur fond clair, jamais inversé sur fond sombre. La marge blanche d'au moins 4 modules est déjà incluse.
- L'URL Apps Script est longue, donc le QR est dense (57 modules). Il s'est décodé en test jusqu'à 2 cm de côté, mais prévoyez 3 cm ou plus et testez l'épreuve imprimée avec plusieurs téléphones.
- Un QR par source si vous voulez distinguer plusieurs stands (`avenir-eco-rennes`, `avenir-eco-vitre`, etc.).

## Présentoir imprimable

Le dossier `display/` génère le présentoir au format 105 × 150 mm (portrait), avec 3 mm de fond perdu : recto avec le QR code, verso avec le numéro du conseiller.

```bash
python3 display/prepare_assets.py recto.jpg verso.jpg      # détoure la mascotte et le logo depuis les photos de l'ancien présentoir
node display/build.js "https://script.google.com/.../exec?src=avenir-eco" --out sortie
```

`build.js` demande `playwright-core` (non installé par `npm install`, car il ne sert qu'à produire le PDF) et un Chromium. Il écrit `presentoir.pdf` (2 pages), `apercu-recto.png`, `apercu-verso.png` et `qr.svg`, et refuse un QR trop dense pour sa taille. Les images Octopus (mascotte, logo) ne sont pas versionnées : le dossier `display/assets/` est ignoré par git.

Deux PDF sont produits : `presentoir.pdf` (111 × 156 mm, 3 mm de fond perdu, pour un imprimeur) et `presentoir-maison-A4.pdf` (2 pages A4, carte à l'échelle 1:1, repères de coupe et règle de contrôle de 10 cm, pour une impression à la maison).

Impression à la maison :

1. Imprimer en **taille réelle / 100 %**, jamais « ajuster à la page » ni « adapter ».
2. Mesurer la règle de contrôle au bas de la page : elle doit faire 10 cm. Sinon, le réglage d'échelle de l'impression est faux.
3. Papier épais (250 à 300 g/m²), d'abord un essai sur papier ordinaire.
4. Découper sur les repères : la zone de fond perdu (3 mm) déborde et doit être coupée. Recto-verso : retourner la feuille sur le bord long, ou coller les deux faces.

Avant d'imprimer : ouvrez le lien du QR dans une fenêtre de navigation privée, sur un téléphone non connecté à un compte Octopus. S'il demande une connexion, personne d'autre que vous ne pourra l'ouvrir.

## Limites à connaître

- **Bandeau Google** : « This application was created by a Google Apps Script user » s'affiche en haut de la page. Il n'existe pas de moyen officiel de l'enlever.
- **Quota d'e-mails** : 100 destinataires par jour avec un compte Gmail personnel (1 500 avec Google Workspace), selon la documentation Google, qui peut changer. Un lead Avenir Eco consomme 2 destinataires, un lead direct 1. Au-delà, le lead est quand même enregistré dans le Sheet, mais les e-mails échouent (colonnes `failed`).
- **Pas d'adresse IP** côté Apps Script : la protection contre les envois en masse est un plafond global de 30 demandes par tranche de 10 minutes, plus un champ piège et un anti-doublon par numéro (5 minutes).
- **URL longue** et non personnalisable (pas de nom de domaine propre).

## Tests locaux

```bash
npm test          # logique, e-mails, Sheet, page (simulation locale des services Google)
npm run preview   # page sur http://localhost:3111/?src=avenir-eco, e-mails affichés dans le terminal
```

Cette simulation (`scripts/gas-harness.js`) vérifie notre code, pas Google lui-même : le bac à sable des iframes, les quotas réels et l'envoi effectif des e-mails ne se vérifient que sur le vrai déploiement (étapes 7 et 10).

## Logo et marque d'Avenir Eco

Le logo vient d'un fichier fourni par Allan Fix, recadré et réduit à environ 9 Ko, puis intégré dans `Logo.gs`. Il n'est affiché que sur les QR du partenaire. Demandez à votre contact d'Avenir Eco de confirmer qu'il est d'accord pour cet usage, et de vous envoyer un nouveau fichier si son logo change.

## Données personnelles

L'application collecte des coordonnées de prospects, stockées dans un Google Sheet du compte qui déploie le script. Ne partagez pas ce Sheet. Avant la mise en production, faites valider avec Octopus Energy France le texte de consentement (`apps-script/index.html`), le responsable de traitement, l'hébergement des données dans un compte Google personnel, la durée de conservation et l'information du partenaire.

## Crédits

Icônes dérivées de [Feather](https://feathericons.com) (licence MIT).
