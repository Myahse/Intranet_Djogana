# Son des notifications (demandes de connexion)

## Fichier utilisé

`mixkit_correct_answer_tone_2870.wav` (son Mixkit). Le fichier d’origine avec des **tirets** dans le nom a été renommé : Android n’accepte que `a-z`, `0-9` et `_` pour les ressources `res/raw/`.

Pour changer de son plus tard :

1. Remplacez le `.wav` dans ce dossier (gardez un nom **sans tirets ni espaces**, ex. `mon_son.wav`).
2. Mettez à jour :
   - `app.config.js` → `sounds: ["./assets/sounds/mon_son.wav"]`
   - `src/notifications/categories.ts` → `sound: "mon_son"` (sans extension)
   - `server/index.cjs` → `sound: 'mon_son.wav'` dans `apns.payload.aps` (demandes de connexion)

3. Rebuild natif (`eas build`) et réinstallez l’app.

## Rappels

- Durée courte recommandée pour une notification.
- Après changement de son sur Android, une **réinstallation** ou vidage des données peut être nécessaire si le canal était déjà créé.
