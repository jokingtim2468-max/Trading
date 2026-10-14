import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { startHeartbeat } from '@/lib/appShell'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

startHeartbeat()
