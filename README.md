# Intranet Djogana

Application web interne pour la gestion de la documentation d'entreprise (formations, procédures, types et articles), avec contrôle d'accès par rôles (RBAC).

**Production :** [https://intranet-djogana.ci](https://intranet-djogana.ci)

---

## Fonctionnalités

### Authentification

- Connexion avec un **identifiant** (numéro de téléphone) et un mot de passe
- Changement de mot de passe depuis le profil
- Validation des connexions via l'application mobile d'approbation
- Compte administrateur initial : `1234567890` / `1234567890` (à modifier en production)

### Documents et dossiers

- Téléversement de fichiers dans des dossiers nommés et des formations « groupe::sous-dossier » (ex. `Module 1::Cours`)
- Navigation et ouverture des documents depuis le tableau de bord
- Suppression de fichiers et de dossiers selon les permissions
- Stockage des fichiers via **Cloudinary**

### Rôles et permissions

- Rôles dynamiques stockés dans PostgreSQL (`roles`)
- Permissions globales par rôle (`role_permissions`) :
  - créer un dossier
  - téléverser un fichier
  - supprimer un fichier
  - supprimer un dossier
- Visibilité des dossiers par rôle (`folder_role_visibility`) :
  - par défaut, tous les rôles voient tous les dossiers
  - l'administrateur peut restreindre certains dossiers à certains rôles
- Interface d'administration (page profil) pour gérer les utilisateurs, les rôles et les permissions

### Notifications

- Notifications push via **Firebase Cloud Messaging** (FCM)

---

## Stack technique

| Couche | Technologies |
|--------|--------------|
| **Frontend** | React, TypeScript, Vite, React Router, Tailwind CSS, Shadcn / Radix UI |
| **Backend** | Node.js, Express |
| **Base de données** | PostgreSQL (Neon) |
| **Fichiers** | Cloudinary |
| **Notifications** | Firebase Admin SDK |
| **Application mobile** | Expo (React Native) — voir `mobile/README.md` |

---

## Architecture de déploiement

```
Navigateur / App mobile
        │
        ▼
https://intranet-djogana.ci          ← Frontend (Vercel)
        │
        │  /api/*  et  /files/*  (proxy Vercel)
        ▼
https://intranet-djogana-fhhd.onrender.com   ← Backend API (Render)
        │
        ├── PostgreSQL (Neon)
        ├── Cloudinary (fichiers)
        └── Firebase (notifications push)
```

- **Vercel** héberge le frontend statique (build Vite) et redirige `/api/*` et `/files/*` vers le backend Render (`vercel.json`).
- **Render** exécute le serveur Express (`npm run start`).
- **Neon** fournit la base PostgreSQL partagée entre les environnements.

---

## Structure du projet

```
Intranet_Djogana/
├── src/                    # Frontend React
│   ├── page/               # Pages (landing, login, dashboard, admin…)
│   ├── contexts/           # AuthContext, DocumentsContext…
│   ├── components/         # Composants UI (Shadcn)
│   └── utils/              # Utilitaires (apiBase, etc.)
├── server/
│   └── index.cjs           # API Express
├── mobile/                 # Application mobile Expo (approbations)
├── Dockerfile              # Image Docker (frontend + API)
├── .gitlab-ci.yml          # Pipeline GitLab (deploy dev / prod)
├── vercel.json             # Rewrites Vercel → backend
└── render.yaml             # Configuration Render (transition)
```

### Principaux endpoints API

| Route | Description |
|-------|-------------|
| `/api/auth/*` | Connexion, inscription, changement de mot de passe |
| `/api/users` | Liste / suppression des utilisateurs |
| `/api/files` | Liste / téléversement / suppression des fichiers |
| `/api/folders` | Liste / création / suppression des dossiers |
| `/api/roles` | Gestion des rôles et permissions |
| `/api/folder-permissions` | Visibilité des dossiers par rôle |
| `/api/health` | Sonde de santé (monitoring) |
| `/files/:id` | Téléchargement / affichage d'un fichier |

---

## Variables d'environnement

Créer un fichier `.env` à la racine du projet (non versionné).

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL (Neon) |
| `JWT_SECRET` | Secret pour les jetons JWT (valeur forte en production) |
| `PUBLIC_BASE_URL` | URL publique du site (`https://intranet-djogana.ci` en production) |
| `VITE_API_BASE_URL` | URL de l'API pour le frontend (vide en dev : proxy Vite vers `localhost:3000`) |
| `CLOUDINARY_CLOUD_NAME` | Identifiant Cloudinary |
| `CLOUDINARY_API_KEY` | Clé API Cloudinary |
| `CLOUDINARY_API_SECRET` | Secret API Cloudinary |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Compte de service Firebase (JSON) pour les notifications push |
| `VITE_ANDROID_APK_URL` | Lien de téléchargement de l'APK Android (page d'accueil) |

> Ne jamais committer le fichier `.env` (il contient des secrets).

### Variables Render (backend)

Sur le tableau de bord Render, configurer au minimum : `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_BASE_URL`, `CLOUDINARY_*`, `FIREBASE_SERVICE_ACCOUNT_JSON`.

### Variables mobile (EAS)

Dans `mobile/eas.json`, `EXPO_PUBLIC_API_URL` pointe vers `https://intranet-djogana.ci` pour les builds preview et production.

---

## Installation et développement local

### Prérequis

- Node.js 22+
- npm
- Compte Neon (PostgreSQL), Cloudinary et Firebase pour les fonctionnalités complètes

### Démarrage

```bash
# À la racine du projet
npm install

# Terminal 1 — Backend (port 3000)
npm run server

# Terminal 2 — Frontend (port 5173, proxy /api et /files vers 3000)
npm run dev
```

Ouvrir [http://localhost:5173](http://localhost:5173).

### Scripts utiles

| Commande | Description |
|--------|-------------|
| `npm run dev` | Serveur de développement Vite |
| `npm run server` | API Express en local |
| `npm run build` | Build de production du frontend |
| `npm run render:build` | Build utilisé par Render (`install` + `build:ci`) |
| `npm run start` | Démarre le serveur Express (production) |
| `npm run lint` | Vérification ESLint |

---

## Déploiement

### Liens GitLab

| Ressource | URL |
|-----------|-----|
| **Dépôt** | [https://gitlab.com/djogana-pay/intranet_web](https://gitlab.com/djogana-pay/intranet_web) |
| **Pipelines CI/CD** | [https://gitlab.com/djogana-pay/intranet_web/-/pipelines](https://gitlab.com/djogana-pay/intranet_web/-/pipelines) |
| **Branches** | `develop` (dev) · `production` (prod) |
| **Merge requests** | [https://gitlab.com/djogana-pay/intranet_web/-/merge_requests](https://gitlab.com/djogana-pay/intranet_web/-/merge_requests) |

### Ports et URLs par environnement

| Environnement | Branche GitLab | Runner tag | Port hôte | Port conteneur | URL publique / accès |
|---------------|----------------|------------|-----------|----------------|----------------------|
| **Développement local** | — | — | `5173` (Vite) · `3000` (API) | — | [http://localhost:5173](http://localhost:5173) |
| **Développement (CI Docker)** | `develop` | `build` | **9091** | **8010** | `http://<serveur-dev>:9091` |
| **Production (CI Docker)** | `production` | `production` | **9091** | **8010** | `http://<serveur-prod>:9091` |
| **Production (site public)** | — | — | — | — | [https://intranet-djogana.ci](https://intranet-djogana.ci) |
| **Backend Render (actuel)** | — | — | — | — | [https://intranet-djogana-fhhd.onrender.com](https://intranet-djogana-fhhd.onrender.com) |

> Le mapping Docker est **`9091:8010`** (hôte:conteneur). Express écoute le port **`8010`** dans le conteneur (`PORT=8010`).

### Déploiement GitLab CI/CD (Docker)

Le fichier [`.gitlab-ci.yml`](.gitlab-ci.yml) déploie automatiquement sur les runners GitLab :

| Job | Branche | Runner |
|-----|---------|--------|
| `deploy-dev` | `develop` | tag `build` |
| `deploy-production` | `production` | tag `production` |

**Prérequis sur chaque runner :**

1. Docker installé et accessible par le runner.

**Variables CI/CD GitLab** — [Settings → CI/CD → Variables](https://gitlab.com/djogana-pay/intranet_web/-/settings/ci_cd)

**Option A — la plus simple (recommandée)**

| Variable | Type | Valeur |
|----------|------|--------|
| `DOTENV_FILE` | **File** | Contenu de votre `.env` local (copier-coller le fichier entier) |

Pour le dev, mettre dans ce `.env` : `PUBLIC_BASE_URL=http://<IP-du-serveur>:9091`

**Option B — variables individuelles**

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `DATABASE_URL` | oui | Connexion PostgreSQL |
| `JWT_SECRET` | oui | Secret JWT (masquer) |
| `PUBLIC_BASE_URL` | oui | `http://<serveur>:9091` (dev) ou `https://intranet-djogana.ci` (prod) |
| `CLOUDINARY_CLOUD_NAME` | oui | Cloudinary |
| `CLOUDINARY_API_KEY` | oui | Cloudinary |
| `CLOUDINARY_API_SECRET` | oui | Cloudinary (masquer) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | non | JSON Firebase sur une ligne (masquer) |

**Option C** — variable `DEPLOY_ENV_FILE` pointant vers un `.env` sur le runner.

**Build manuel (test local) :**

```bash
docker build -t intranet_web:local .
docker run --rm -p 9091:8010 -e PORT=8010 --env-file .env intranet_web:local
curl http://localhost:9091/api/health
```

### Frontend (Vercel)

1. Connecter le dépôt à Vercel.
2. Commande de build : `npm run build:ci`
3. Répertoire de sortie : `dist`
4. Le fichier `vercel.json` configure le proxy `/api` et `/files` vers le backend.

### Backend (Render — transition)

1. Service Web Node.js sur Render.
2. Build : `npm run render:build` · Start : `npm run start`
3. Variables d'environnement identiques au déploiement Docker.
4. `PUBLIC_BASE_URL` = `https://intranet-djogana.ci`

### Vérification

```bash
# Conteneur Docker sur le runner (dev ou prod)
curl http://localhost:9091/api/health

# Backend Render
curl https://intranet-djogana-fhhd.onrender.com/api/health

# Site public via Vercel (proxy)
curl https://intranet-djogana.ci/api/health
```

> Sur le plan gratuit Render, le premier appel après inactivité peut prendre 30 à 60 secondes (cold start).

---

## Application mobile

L'application Expo dans `mobile/` permet d'approuver ou de refuser les demandes de connexion à la plateforme. Voir [mobile/README.md](mobile/README.md) pour l'installation et le lancement.

---

## Dépôt et branches

| Branche | Usage |
|---------|--------|
| `develop` | Développement — déploiement auto via `deploy-dev` |
| `production` | Production — déploiement auto via `deploy-production` |
| `main` | Miroir GitHub (historique) |

**GitLab :** [https://gitlab.com/djogana-pay/intranet_web](https://gitlab.com/djogana-pay/intranet_web)

---

## Licence

Usage interne — Djogana Pay.
