# Rappel Avenir Eco

Page mobile « Me faire rappeler » accessible par QR code, pour les moments où le conseiller n'est pas sur le stand. Chaque demande est enregistrée, le conseiller reçoit un e-mail complet et le contact du partenaire (Avenir Eco) est prévenu quand le lead vient de son stand.

Serveur Node.js sans dépendance (Node 18 ou plus). La seule dépendance, `qrcode`, sert uniquement au script de génération des QR codes.

## Fonctionnement

- `https://votre-domaine/?src=avenir-eco` : le paramètre `src` identifie l'origine du lead. Une source qui commence par `avenir-eco` (par exemple `avenir-eco-rennes`) déclenche l'e-mail au partenaire. Sans `src`, la source est `direct` et seul le conseiller est prévenu.
- `/contact` redirige vers la fiche vCard (variable `VCARD_URL`).
- `POST /api/callback` reçoit le formulaire. Le lead est écrit dans `data/leads.jsonl`, puis les e-mails partent. Le client voit un succès si le lead est enregistré ou si l'e-mail au conseiller est parti.
- Les leads de plus de `RETENTION_DAYS` jours (365 par défaut, comme annoncé aux clients) sont supprimés chaque jour.

## Configuration

| Variable | Rôle |
| --- | --- |
| `OWNER_EMAIL` | E-mail du conseiller (reçoit chaque lead complet). Plusieurs adresses possibles, séparées par des virgules. |
| `AVENIR_ECO_EMAIL` | E-mail du contact Avenir Eco (plusieurs possibles, séparés par des virgules). |
| `PARTNER_SHARE_CONTACT` | `1` pour inclure téléphone et e-mail du client dans le message au partenaire. Par défaut : prénom, créneau et heure seulement. |
| `RESEND_API_KEY`, `MAIL_FROM` | Envoi réel via [Resend](https://resend.com). L'adresse `MAIL_FROM` doit appartenir à un domaine vérifié chez Resend. |
| `MAILER` | `resend` (automatique si `RESEND_API_KEY` est défini) ou `log` (affiche les e-mails sans les envoyer, pour tester). |
| `DATA_FILE` | Fichier des leads. Doit être sur un disque persistant. |
| `TRUST_PROXY` | `1` derrière un proxy : l'IP du client est lue dans la dernière entrée de `X-Forwarded-For`. |
| `PORT`, `RETENTION_DAYS`, `RATE_LIMIT_MAX`, `VCARD_URL`, `BASE_URL` | Réglages optionnels. |

Le profil affiché (nom, titre, téléphone, liens) est dans `config/profile.json`. Les partenaires sont dans `config/partners.json`.

## Lancer et tester

```bash
OWNER_EMAIL=vous@exemple.fr AVENIR_ECO_EMAIL=contact@exemple.fr npm start
npm test
```

## Générer les QR codes

```bash
npm install
node scripts/make-qr.js https://votre-domaine.fr avenir-eco
```

Le script écrit `qr/<source>.svg` (à donner à l'imprimeur) et `qr/<source>.png`. Il refuse les URL en `http://`.

Pour l'impression : le QR doit rester noir sur fond clair, avec la marge blanche d'au moins 4 modules déjà incluse, jamais inversé sur fond sombre. Un QR de 2 cm de côté a été décodé avec succès en test. Le QR étant imprimé, l'URL doit rester valable : utilisez un nom de domaine à vous plutôt qu'une adresse d'hébergeur.

## Données personnelles

L'application collecte des coordonnées de prospects. Avant la mise en production, faites valider avec Octopus Energy France le texte de consentement (`views/index.html`), le responsable de traitement, la durée de conservation et le partage d'informations avec Avenir Eco.

## Crédits

Icônes dérivées de [Feather](https://feathericons.com) (licence MIT).
