const appJson = require("./app.json");

// Expo lit la config au format { expo: { ... } }.
// On repart de app.json et on ajoute extra.apiUrl.
module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      // Inclus dans l'APK au build EAS (env du profil preview/production)
      apiUrl: process.env.EXPO_PUBLIC_API_URL || "",
    },
  },
};
