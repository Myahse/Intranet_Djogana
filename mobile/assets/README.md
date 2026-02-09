# Assets

Expo uses these image files for the app icon, splash screen, and Android adaptive icon. They are copied from the Djogana logo: `src/assets/logo_djogana.png` (at project root).

- **icon.png** – app / launcher icon
- **splash-icon.png** – splash screen image
- **adaptive-icon.png** – Android adaptive icon foreground
- **favicon.png** – web favicon

To refresh from the main project logo (from repo root):

```bash
cp ../../src/assets/logo_djogana.png ./assets/icon.png
cp ../../src/assets/logo_djogana.png ./assets/adaptive-icon.png
cp ../../src/assets/logo_djogana.png ./assets/splash-icon.png
cp ../../src/assets/logo_djogana.png ./assets/favicon.png
```

Invalid or corrupt PNGs can cause prebuild to fail with a **Crc error** in `jimp-compact`.

## Fix prebuild CRC error

If EAS prebuild fails with `Crc error` when reading PNGs, overwrite placeholders with valid minimal PNGs:

```bash
node scripts/ensure-valid-assets.cjs
```

Then commit the updated files and re-run the EAS build. For production, replace these with proper 1024×1024 icons.

## Use Expo template assets (optional)

To get full-size default icons instead of minimal placeholders:

```bash
npx create-expo-app@latest _expo-temp --template blank-typescript
cp _expo-temp/assets/* ./assets/
rm -rf _expo-temp
```

Windows (PowerShell):

```powershell
npx create-expo-app@latest _expo-temp --template blank-typescript
Copy-Item _expo-temp\assets\* .\assets\
Remove-Item -Recurse -Force _expo-temp
```
