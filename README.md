# A2gent Web App

React + TypeScript frontend for the `aagent` HTTP API.

## Development

```bash
npm install
npm run dev
```

Default dev URL: `http://localhost:5173`

Build and preview:

```bash
npm run build
npm run preview
```

## Backend API

By default the app calls:

- `http://localhost:8080`

You can override the API base URL:

- With `VITE_API_URL` at build time.
- In-app via local storage key `a2gent.api_base_url`.

## Current Session UX

- Sessions list view shows existing sessions and supports delete/select.
- New session creation is available directly from the sessions page composer at the bottom.
- The composer includes text input, voice input, and send controls.

## Session Grouping and Folder Binding

Current behavior (as of February 13, 2026):

- The frontend does not provide project-based grouping of sessions.
- The frontend does not bind sessions to a specific filesystem folder/project in UI state.
- API session payloads consumed by the frontend currently do not expose a first-class project/folder grouping model.

What exists in backend session relationships:

- Parent-child relationships via `parent_id`.
- Job-associated sessions via `job_id`.

## Main Scripts

- `npm run dev` - Start Vite development server
- `npm run build` - Type-check and build production assets
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build locally
