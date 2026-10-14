import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { startHeartbeat } from '@/lib/appShell'
import { applyMotion } from '@/lib/motionPref'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

applyMotion()
// The desktop app has no Windows frame: make room for QuantBot's own title bar
if (window.quantbotDesktop) document.documentElement.classList.add('desktop-frame')
// The opening zoom (added by the desktop app) is removed once played, so #root keeps no transform afterwards
document.getElementById('root').addEventListener('animationend', (e) => {
  if (e.animationName !== 'app-open') return
  document.documentElement.classList.remove('app-opening')
  document.documentElement.dataset.opened = 'zoom'
})
startHeartbeat()
