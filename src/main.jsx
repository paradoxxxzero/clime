import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

const qs = new URLSearchParams(location.search)

export const hours = parseFloat(qs.get('hours') || '5')
export const latlngs =
  qs.getAll('latlng').map(v => v.split(',').map(parseFloat)) || []

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
