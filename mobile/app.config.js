module.exports = {
  expo: {
    name: "Auth Intranet",
    slug: "auth-intranet",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    scheme: "djogana",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#000000",
    },

    owner: "yarhas-organization",

    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.djogana.approval",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000",
      },
      package: "com.djogana.approval",
      googleServicesFile: "./google_service_files/google-services-android.json",
    },
    updates: {
      // Enable EAS Update (OTA) for JS-only updates.
      // Native changes still require a new build.
      url: "https://u.expo.dev/6ae03c31-2398-4710-9a5d-8f1cb7ac8156",
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: {
      // OTA updates are applied only when runtimeVersion matches.
      // Using appVersion keeps it safe across breaking native changes.
      policy: "appVersion",
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-task-manager",
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 24,
          },
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#000000",
          defaultChannel: "default",
          enableBackgroundRemoteNotifications: true,
          // Copié dans le bundle natif (Android res/raw + iOS). Nom sans tirets (règles Android).
          sounds: ["./assets/sounds/mixkit_correct_answer_tone_2870.wav"],
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: "6ae03c31-2398-4710-9a5d-8f1cb7ac8156",
      },
      // Included in the APK at EAS build time (from preview/production profile env)
      apiUrl: process.env.EXPO_PUBLIC_API_URL || "",
    },
  },
};
