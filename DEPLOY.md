## Deploying CAIMEO (Frontend + Backend)

This project has two parts:
- **Frontend:** React app in `alpaca-ui/`
- **Backend:** FastAPI app (`server.py`)

### Backend (FastAPI)
1) Choose a host: Render, Railway, Fly.io, or a small VPS. These steps assume Render/Railway.
2) Start command (Render/Railway “Web Service”):
   ```
   uvicorn server:app --host 0.0.0.0 --port $PORT
   ```
3) Env vars (set in the host dashboard):
   - `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`, `APCA_API_BASE_URL` (paper or live)
   - `MAX_DAY_TRADES_PER_WEEK` (default 65)
   - `TRADE_POLL_SEC`, `MIN_TRADE_CONFIDENCE`, etc., as needed
4) Requirements: Ensure `requirements.txt` is used by the host for install.
5) CORS: If you use a custom frontend origin, update `CORSMiddleware` in `server.py` to include it (e.g., `https://your-frontend.netlify.app`).
6) Binding: Hosts like Render/Railway inject `$PORT`; the start command above binds to it.

### Frontend (React)
1) Set the backend URL at build time:
   - In deploy settings, add `REACT_APP_SERVER_URL=https://your-backend-host`
2) Build:
   ```
   cd alpaca-ui
   npm install
   npm run build
   ```
3) Deploy the `alpaca-ui/build` folder:
   - **Netlify:** Build command `npm run build`, publish directory `alpaca-ui/build`.
   - **Vercel:** Framework “Other,” build `npm run build`, output `alpaca-ui/build`.
   - **GitHub Pages:** Serve the `build/` folder; ensure `REACT_APP_SERVER_URL` points to your backend.

### Custom Domain (optional)
- Point your domain to the frontend host (Netlify/Vercel DNS).
- If using an API subdomain (e.g., `api.yourdomain.com`), CNAME/A it to the backend host and update `REACT_APP_SERVER_URL`.

### Quick validation
- Open frontend URL; in browser dev tools Network tab, ensure `/status`, `/progress`, `/positions` return 200 and no CORS errors.
- Backend logs should show “✅ Alpaca authentication successful” after auth and “🤖 Auto-trader running” after start.
