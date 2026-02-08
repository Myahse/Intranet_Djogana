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

1. Copiez `.env.example` en `.env`.
2. Dans `.env`, définissez `EXPO_PUBLIC_API_URL` avec l’URL de votre backend :
   - Sur simulateur : `http://localhost:3000`
   - Sur appareil physique : `http://VOTRE_IP:3000` (ex. `http://192.168.1.10:3000`)

3. **Première fois** : ajoutez les assets (icône, splash). Voir `assets/README.md`.

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

## Scripts

- `npm start` – démarre le serveur de développement Expo
- `npm run android` – lance sur Android
- `npm run ios` – lance sur iOS
