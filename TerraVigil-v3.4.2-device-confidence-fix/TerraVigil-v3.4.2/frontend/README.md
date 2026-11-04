# TerraVigil 3.2 frontend

Use the compiled frontend through `npm start` from the application root.
Open http://localhost:3000/connections. Model inference is removed from navigation.
The old `/model` address redirects to the Firebase connection screen.
See ../START_HERE.md for setup and ../README.md for routes and configuration.

For frontend development, run `npm run setup:dev` from the root, start the backend,
then `npm --prefix frontend run dev`. Vite proxies `/api` to localhost:3000.
The frontend uses no Firebase credentials. All authentication happens in Python.
This production frontend uses captured mission data. Demo import and sample-loading controls are removed.
