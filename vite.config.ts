import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Dev server: /practice/ is a static page in public/, not the app (vite preview and Pages already serve it so). */
function practicePage(): Plugin {
  return {
    name: 'oneof-practice-page',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/practice\/?(\?.*)?$/.test(req.url)) req.url = '/practice/index.html';
        next();
      });
    },
  };
}

// BASE_PATH lets the same build run at / (local, Firebase Hosting) or /oneof/ (GitHub Pages).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [practicePage(), react()],
})
