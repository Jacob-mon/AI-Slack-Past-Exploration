import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.API_KEY': JSON.stringify(process.env.VITE_API_KEY),
    'process.env.SLACK_TOKEN': JSON.stringify(process.env.VITE_SLACK_TOKEN)
  }
})
