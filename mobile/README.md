# Djogana – Application mobile d’approbation

Application Expo (React Native) pour **approuver ou refuser les demandes d’accès** à la plateforme Intranet Djogana, comme sur GitHub.

## Prérequis

- Node.js 18+
- npm ou yarn
- Expo Go sur votre téléphone (ou simulateur iOS / Android)

## Installation

```bash
cd mobile
npm install
```

## Configuration

1. **Réseau** : sur le **même Wi‑Fi**, l’app utilise automatiquement la machine où tourne Expo (pas besoin de configurer l’IP). Il suffit que le serveur tourne sur le PC (`npm run server` à la racine). Si ça ne marche pas : pare-feu Windows → autoriser le port 3000 pour Node.
   - Pour forcer une URL (ex. backend ailleurs) : dans `mobile/.env`, définir `EXPO_PUBLIC_API_URL=http://IP:3000`.

2. **Première fois** : ajoutez les assets (icône, splash). Voir `assets/README.md`.

## Lancer l’app

```bash
npm start
```

Puis scannez le QR code avec Expo Go (Android) ou l’app Caméra (iOS).

## Utilisation

1. **Connexion** : ouvrez l’app, connectez-vous avec votre **identifiant** et **mot de passe** (compte Intranet Djogana).
2. **Demandes de connexion** : la liste des demandes en attente s’affiche. Chaque entrée affiche un **code** (le même que sur l’écran web).
3. **Approuver / Refuser** : appuyez sur **Approuver** pour autoriser l’accès à la plateforme depuis l’autre appareil, ou **Refuser** pour le bloquer.

L’utilisateur sur le web voit sa demande se mettre à jour (connexion accordée ou refusée) sans rien faire d’autre.

## Structure

- `app/` – routes Expo Router (écran d’accueil, connexion, demandes)
- `src/api.ts` – appels API (login, liste des demandes, approuver, refuser)
- `src/storage.ts` – stockage sécurisé du token (expo-secure-store)
- `src/contexts/AuthContext.tsx` – état d’authentification

cd## Build APK (Android) et iOS

Pour générer un **APK Android** et un **build iOS** (pour TestFlight ou App Store), utilisez [EAS Build](https://docs.expo.dev/build/introduction/) (Expo Application Services).

### Prérequis

- Compte [Expo](https://expo.dev/signup) (gratuit)
- EAS CLI : `npm install -g eas-cli`

### Configuration

1. Connectez-vous : `eas login`
2. Liez le projet (première fois) : `eas build:configure` (déjà fait si `eas.json` existe)

### Commandes de build

**Android – APK** (fichier .apk à installer directement sur appareil ou émulateur) :

```bash
cd mobile
eas build --platform android --profile preview
```

À la fin du build, un lien permet de télécharger l’APK.

**iOS** (build pour simulateur ou appareil réel ; appareil réel nécessite un compte Apple Developer) :

```bash
eas build --platform ios --profile preview
```

**Les deux plateformes** :

```bash
eas build --platform all --profile preview
```

### Profils dans `eas.json`

- **preview** : APK pour Android, build iOS pour test interne. Idéal pour tester sans publier.
- **production** : AAB (Play Store) et build iOS pour soumission App Store. À utiliser pour la publication.

Pour un **APK de production** (Android uniquement) :

```bash
eas build --platform android --profile production
```

Puis dans `eas.json`, pour obtenir un APK au lieu d’un AAB en production, vous pouvez dupliquer le profil et mettre `"buildType": "apk"` sous `android`.

## Scripts

- `npm start` – démarre le serveur de développement Expo
- `npm run android` – lance sur Android
- `npm run ios` – lance sur iOS
