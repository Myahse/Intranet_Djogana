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
- **Android** : le son du **canal** est mis en cache par l’OS. Si vous changez le fichier `.wav`, incrémentez `APPROVAL_CHANNEL_ID` dans `mobile/src/notifications/constants.ts` **et** le même `channelId` dans `server/index.cjs` (payload FCM).
- Les pushes **data-only** doivent inclure `sound: '…_sans_extension'` dans le **data** FCM, sinon Expo utilise le son système par défaut.
