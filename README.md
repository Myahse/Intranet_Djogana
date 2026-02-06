## Intranet Djogana

Intranet Djogana is an internal web app for managing company documentation (formations, procédures, types & articles) with simple role‑based access control (RBAC).

The project has:
- **Frontend**: React + TypeScript + Vite
- **Backend**: Node/Express + Postgres (Neon)

---

### Features

- **Authentication**
  - Login with an `identifiant` (phone number) and password
  - Change password from the profile page
  - Initial admin user: `1234567890` / `1234567890` (to change later)

- **Documents & folders**
  - Upload files into named folders and “group::subfolder” formations (e.g. `Module 1::Cours`)
  - Browse and open documents from the dashboard
  - Delete files and folders (according to permissions)

- **Roles & permissions**
  - Dynamic roles stored in Postgres (`roles`)
  - Per‑role global permissions (`role_permissions`):
    - create folder
    - upload file
    - delete file
    - delete folder
  - Folder visibility rules (`folder_role_visibility`):
    - By default, folders are visible to all roles
    - Admin can restrict specific folders to specific roles
  - Admin UI (profile page) to:
    - Create roles and toggle permissions
    - Create users and assign them a role

---

### Tech stack

- **Frontend**
  - React + TypeScript
  - Vite
  - React Router
  - Shadcn / Radix UI components

- **Backend**
  - Node.js + Express
  - `pg` (Postgres)
  - `multer` (file uploads stored in DB as `bytea`)
  - `bcryptjs` (password hashing)
  - Neon Postgres via `DATABASE_URL`

---

### Structure (high‑level)

- `src/`
  - `page/landing/landing.tsx` – public landing + navbar
  - `page/login/login.tsx` – login page (same navbar)
  - `page/dashboard/dashboard.tsx` – dashboard layout, sidebar, profile bottom‑sheet
  - `page/dashboard/DocumentSection.tsx` – document listing
  - `page/dashboard/ProfilePage.tsx` – profile, users, roles & permissions, folders
  - `contexts/AuthContext.tsx` – auth state + API calls
  - `contexts/DocumentsContext.tsx` – documents/folders state + API calls
  - `components/ui/*` – Shadcn/Radix UI primitives
- `server/index.cjs`
  - Express API:
    - `/api/auth/*` – login, register, change password
    - `/api/users` – list/delete users
    - `/api/files` – list/upload/delete files
    - `/api/folders` – list/create/delete folders
    - `/api/roles` – list/create roles
    - `/api/roles/:id/permissions` – update role permissions
    - `/api/folder-permissions` – per‑role folder visibility
  - DB initialization for tables:
    - `users`, `folders`, `files`
    - `roles`, `role_permissions`, `folder_role_visibility`

---

### Environment variables

Defined in `.env` in `Intranet_Djogana`:

- `VITE_API_BASE_URL` – frontend → backend base URL (default `http://localhost:3000`)
- `PUBLIC_BASE_URL` – base URL for generated file links
- `DATABASE_URL` – Postgres connection string (Neon)

Ensure `DATABASE_URL` points to the same project/branch/database you inspect in Neon.

---

### Running locally

From `Intranet_Djogana/`:

npm install

# Backend
npm run server  # runs Express on port 3000

# Frontend (in another terminal)
npm run dev     # opens Vite dev server (e.g. http://localhost:5173)
