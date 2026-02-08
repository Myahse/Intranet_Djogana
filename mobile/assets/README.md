# Assets

Expo needs these image files to run the app. If they are missing, create them or copy from an Expo template:

- **icon.png** – 1024×1024 app icon
- **splash-icon.png** – splash screen image
- **adaptive-icon.png** – 1024×1024 Android adaptive icon foreground
- **favicon.png** – web favicon

Quick setup (from project root):

```bash
npx create-expo-app@latest _expo-temp --template blank-typescript
cp _expo-temp/assets/* ./assets/
rm -rf _expo-temp
```

On Windows (PowerShell):

```powershell
npx create-expo-app@latest _expo-temp --template blank-typescript
Copy-Item _expo-temp\assets\* .\assets\
Remove-Item -Recurse -Force _expo-temp
```
