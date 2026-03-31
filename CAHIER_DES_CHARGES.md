# Cahier des charges — Intranet Djogana

**Version :** 1.1  
**Date :** 27 mars 2026  
**Projet :** Plateforme intranet de gestion documentaire et de collaboration

---

## 1. Contexte et objectifs du projet

### 1.1 Contexte

L’entreprise Djogana souhaite disposer d’une plateforme intranet centralisée pour la gestion de sa documentation interne (formations, modes d’opération, types et articles). La solution doit permettre de structurer, partager et sécuriser l’accès aux documents par direction, tout en offrant des mécanismes de collaboration et de contrôle d’accès adaptés à l’organisation.

### 1.2 Objectifs

- **Centraliser** la documentation d’entreprise dans un espace unique et structuré
- **Sécuriser** l’accès aux documents via une gestion des profils et des Habilitations (RBAC)
- **Faciliter** la collaboration entre les directions et les équipes
- **Permettre** une authentification renforcée via une connexion par appareil (flux type GitHub)
- **Fournir** des outils d’administration et de pilotage (statistiques, surveillance en temps réel)
- **Proposer** une expérience utilisateur moderne sur web et mobile

---

## 2. Périmètre du projet

### 2.1 Périmètre fonctionnel inclus

| Domaine | Description |
|--------|-------------|
| Authentification | Connexion classique, connexion par appareil, changement de mot de passe, suspension de compte |
| Gestion documentaire | Dossiers, fichiers, liens, upload, prévisualisation, corbeille |
| Gestion des directions | Création, modification, suppression, accès par direction |
| Gestion des utilisateurs | Création, suppression, suspension, attribution d'profils |
| Gestion des profils | RBAC avec Habilitations granulaires |
| Administration | Statistiques, journal d’activité, surveillance en temps réel |
| Application mobile | Approbation des demandes de connexion, notifications push, authentification biométrique |

### 2.2 Périmètre exclu

- Intégration avec des systèmes tiers (ERP, RH, etc.) non prévus
- Gestion de la facturation ou des abonnements
- Versionnement avancé des documents (historique des versions)
- Workflow de validation documentaire (approbation multi-niveaux)
- Application mobile complète de consultation des documents (hors approbation de connexion)

---

## 3. Description fonctionnelle détaillée

### 3.1 Authentification et sécurité

| Fonctionnalité | Description | Priorité |
|----------------|-------------|----------|
| Connexion identifiant / mot de passe | Connexion via identifiant (ex. numéro de téléphone) et mot de passe | P0 |
| Changement de mot de passe obligatoire | Obligation de changer le mot de passe à la première connexion | P0 |
| Connexion par appareil | Demande de connexion depuis le web, approbation ou refus sur l’application mobile (flux type GitHub) | P0 |
| Tokens de session | JWT stocké côté client en `sessionStorage` (session navigateur) | P0 |
| Expiration des tokens | Expiration serveur configurable (par défaut 15 minutes) | P0 |
| Déconnexion par inactivité | Déconnexion automatique après 15 minutes sans interaction (configurable) | P0 |
| Déconnexion au changement de focus (option) | Option de déconnexion immédiate si l’utilisateur quitte l’onglet/la fenêtre | P1 |
| Modal “Session expirée” | Affichage d’un modal informant l’utilisateur lors d’une déconnexion automatique (inactivité / token expiré) | P1 |
| Suspension de compte | L’administrateur peut suspendre un compte utilisateur | P0 |
| Authentification biométrique (mobile) | Passkey / biométrie pour les actions rapides sur mobile | P1 |

### 3.2 Gestion documentaire

| Fonctionnalité | Description | Priorité |
|----------------|-------------|----------|
| Arborescence par directions | Dossiers organisés par direction avec sous-dossiers (notation interne `direction_id::dossier::sous-dossier`) | P0 |
| Séparateur de niveaux (UX) | Affichage utilisateur avec “ / ”, converti en `::` en interne | P0 |
| Fichier + dossier même nom | Un fichier et un dossier peuvent partager le même nom dans le même parent (comportement type explorateur) | P1 |
| Types de fichiers supportés | PDF, Word, Excel, PowerPoint, images, vidéos, audio, APK, ZIP, RAR | P0 |
| Upload de fichiers | Upload direct vers le stockage cloud, upload par parties pour fichiers volumineux (> 6 Mo) | P0 |
| Liens (URLs) | Création de liens associés aux dossiers | P0 |
| Visibilité des dossiers | `public` ou `direction_only` | P0 |
| Prévisualisation | Prévisualisation Office via Microsoft Office Online Viewer | P1 |
| Extraction d’icônes APK | Extraction automatique des icônes pour les fichiers APK | P2 |
| Corbeille | Suppression logicielle (soft delete), restauration, suppression définitive | P0 |
| Déplacement de dossiers | Déplacement d’un dossier (et de son sous-arbre) vers un autre dossier de la même direction | P0 |
| Normalisation des chemins | Normalisation des chemins de dossiers côté API (conversion “ / ” → `::`, suppression des séparateurs de bord) | P0 |

### 3.3 Interface utilisateur — Section documents

| Fonctionnalité | Description | Priorité |
|----------------|-------------|----------|
| Vues | Affichage en tuiles, liste ou détails | P0 |
| Tri | Par nom, taille, date, type | P0 |
| Recherche et filtres | Recherche dans la sidebar, filtres par type de fichier | P0 |
| Actions | Upload, création de lien, suppression, renommage | P0 |
| Panneaux redimensionnables | Panneaux ajustables pour l’ergonomie | P1 |

### 3.4 Administration

| Fonctionnalité | Description | Priorité |
|----------------|-------------|----------|
| Statistiques globales | Utilisateurs, directions, dossiers, fichiers, stockage, liens | P0 |
| Graphiques | Types de fichiers, évolution par mois, fichiers par direction | P0 |
| Journal d’activité | Actions récentes (upload, suppression, création, etc.) | P0 |
| Top contributeurs | Classement des contributeurs les plus actifs | P1 |
| Périodes d’analyse | 7j, 30j, 3m, 6m, 12m, personnalisé | P0 |
| Surveillance en temps réel | Utilisateurs connectés, actions en direct (connexion, upload, suppression, etc.) | P1 |
| Mise à jour temps réel | Mise à jour en temps réel des Habilitations et de la présence | P0 |

### 3.5 Gestion des utilisateurs et des directions

| Fonctionnalité | Description | Priorité |
|----------------|-------------|----------|
| Directions | Création, modification, suppression | P0 |
| Utilisateurs | Création (nom et prénoms obligatoires), suppression, suspension | P0 |
| Chef de direction | Gestion de sa direction, statistiques limitées à sa direction | P0 |
| Accès multi-directions | Habilitations pour plusieurs directions par utilisateur | P0 |
| Profils et RBAC | Habilitations granulaires par profil | P0 |

### 3.6 Habilitations (RBAC)

| Habilitation | Description |
|------------|-------------|
| `can_create_folder` | Créer des dossiers |
| `can_upload_file` | Téléverser des fichiers |
| `can_delete_file` | Supprimer des fichiers |
| `can_delete_folder` | Supprimer des dossiers |
| `can_create_user` | Créer des utilisateurs |
| `can_delete_user` | Supprimer des utilisateurs |
| `can_create_direction` | Créer des directions |
| `can_delete_direction` | Supprimer des directions |
| `can_view_activity_log` | Consulter le journal d’activité |
| `can_set_folder_visibility` | Définir la visibilité des dossiers |
| `can_view_stats` | Consulter les statistiques |

### 3.7 Profils et parcours utilisateurs

| Profil | Parcours principal |
|--------|---------------------|
| **Administrateur** | Accès complet : directions, utilisateurs, profils, statistiques, corbeille, surveillance en temps réel, approbation des demandes de connexion |
| **Chef de direction** | Gestion de sa direction, statistiques de sa direction, accès aux dossiers de sa direction |
| **Utilisateur** | Accès aux dossiers selon sa direction et ses Habilitations, upload/lecture/suppression selon le profil, statistiques si `can_view_stats` |

---

## 4. Architecture

### 4.1 Modèle de données (principales entités)

| Table | Description |
|-------|-------------|
| `users` | Utilisateurs (nom, prénoms, identifiant, mot de passe hashé, profil, direction, etc.) |
| `directions` | Directions / départements |
| `folders` | Dossiers (hiérarchie via `direction_id::nom`) |
| `files` | Fichiers (référence stockage, métadonnées) |
| `links` | Liens URL associés aux dossiers |
| `roles` | Profils |
| `role_permissions` | Habilitations par profil |
| `activity_log` | Journal d’activité |
| `login_requests` | Demandes de connexion par appareil |
| `push_tokens` | Tokens pour notifications push |
| `direction_access` | Accès utilisateur par direction |
| `folder_permissions` | Habilitations par dossier |

### 4.2 API (principaux endpoints)

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/auth/login` | POST | Connexion |
| `/api/auth/me` | GET | Utilisateur courant |
| `/api/auth/change-password` | POST | Changement de mot de passe |
| `/api/auth/device/request` | POST | Demande de connexion par appareil |
| `/api/auth/device/approve` | POST | Approbation |
| `/api/auth/device/deny` | POST | Refus |
| `/api/directions` | GET/POST | Directions |
| `/api/users` | GET | Utilisateurs |
| `/api/roles` | GET/POST | Profils |
| `/api/folders` | GET/POST | Dossiers |
| `/api/folders/rename` | PATCH | Renommage d’un dossier (sous-arbre inclus) |
| `/api/folders/move` | POST | Déplacement d’un dossier vers un autre (sous-arbre inclus) |
| `/api/files` | GET/POST | Fichiers |
| `/api/files/sign` | POST | Signature pour upload |
| `/api/files/register` | POST | Enregistrement fichier |
| `/api/links` | GET/POST | Liens |
| `/api/trash` | GET | Corbeille |
| `/api/admin/stats` | GET | Statistiques |
| `/api/admin/online-users` | GET | Utilisateurs en ligne |
| `/api/admin/live` | GET | Surveillance en direct |
| `/api/activity-log` | GET | Journal d’activité |

---

## 5. Exigences non fonctionnelles

### 5.1 Performance

- Temps de chargement initial de la page < 3 secondes (connexion standard)
- Upload de fichiers volumineux par parties
- Mise en cache des ressources statiques

### 5.2 Sécurité

- Mots de passe hashés de manière sécurisée
- Tokens d’authentification avec secret robuste
- JWT avec expiration côté serveur (par défaut 15 minutes)
- Déconnexion automatique par inactivité (par défaut 15 minutes)
- Option de déconnexion immédiate au changement d’onglet/fenêtre (si activée)
- Configuration des domaines autorisés
- Connexion base de données sécurisée (SSL)

### 5.3 Disponibilité

- Hébergement adapté à un usage interne (ex. Render, Vercel, ou infrastructure dédiée)
- Base de données managée

### 5.4 Compatibilité

- Navigateurs modernes (Chrome, Firefox, Edge, Safari)
- Application mobile iOS et Android
- Responsive design pour les écrans desktop et tablette

### 5.5 Maintenabilité

- Code typé côté interface
- Structure modulaire (contextes, composants, pages)
- Variables d’environnement pour la configuration

---

## 6. Contraintes et hypothèses

### 6.1 Contraintes

- Base de données relationnelle requise
- Stockage des fichiers dans le cloud (pas de stockage local en production)
- Service de notifications push pour l’application mobile
- Connexion par appareil nécessitant l’application mobile installée

### 6.2 Hypothèses

- Les utilisateurs disposent d’un accès internet stable
- Les documents sont principalement en français
- L’organisation par directions est stable et connue
- Au moins un administrateur est formé pour la gestion des profils et des Habilitations
- L’application mobile est utilisée principalement pour l’approbation des connexions

---

## 7. Livrables

| Livrable | Description |
|----------|-------------|
| Application web | Interface déployée et accessible via URL |
| API backend | Serveur API déployé et opérationnel |
| Application mobile | Application compilée (APK / AAB pour Android, build iOS si nécessaire) |
| Base de données | Schéma initialisé et migré |
| Documentation | README, variables d’environnement (.env.example), cahier des charges |
| Compte administrateur initial | Identifiant et mot de passe à modifier à la première connexion |

---

## 8. Configuration

| Élément | Description | Obligatoire |
|--------|-------------|-------------|
| URL de l’API | URL de base de l’API pour l’interface | Non (valeur par défaut en développement) |
| Secret d’authentification | Secret pour les tokens (min. 32 caractères) | Oui |
| Port du serveur | Port du serveur backend | Non (défaut : 3000) |
| URL publique | URL publique du backend | Oui |
| Base de données | Chaîne de connexion à la base de données | Oui |
| Stockage fichiers | Identifiants du service de stockage cloud | Oui |
| Notifications push | Identifiants du service de notifications | Oui (pour mobile) |
| Expiration JWT | Durée d’expiration des tokens JWT (ex. `15m`) | Non (défaut : 15m) |
| Inactivité (web) | Durée d’inactivité avant déconnexion (ms) | Non (défaut : 900000) |
| Logout on blur (web) | Déconnexion immédiate si l’utilisateur quitte l’onglet/fenêtre | Non (défaut : false) |

---

## 9. Glossaire

| Terme | Définition |
|-------|------------|
| **RBAC** | Contrôle d'accès basé sur les profils |
| **Soft delete** | Suppression logicielle (enregistrement conservé, récupérable) |
| **Connexion par appareil** | Flux d’authentification où une demande web est approuvée depuis un appareil mobile |
| **Direction** | Unité organisationnelle (département, service) |


