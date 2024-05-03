import { useEffect, useMemo, useState } from 'react'
import './App.css'

const round5 = num => {
  return Math.floor(num / 5) * 5
}

function pad(num, size) {
  num = num.toString()
  while (num.length < size) num = '0' + num
  return num
}

const format = date =>
  `${date.toISOString().replace(/[-T]/g, '').split(':')[0]}${pad(
    round5(date.getMinutes()),
    2
  )}`

const url = frame =>
  `https://imn-api.meteoplaza.com/v4/nowcast/tiles/satellite-europe/${frame}/7/41/59/50/70?outputtype=jpeg`

export default function App() {
  const [time, setTime] = useState(() => new Date().getTime() - 15 * 60 * 1000)

  useEffect(() => {
    let cursor
    const down = e => {
      // document.body.style.cursor = 'grabbing'
      cursor = { x: e.clientX, y: e.clientY }
      e.preventDefault()
    }

    const move = e => {
      if (cursor) {
        const x = cursor.x - e.clientX
        const y = cursor.y - e.clientY
        cursor = { x: e.clientX, y: e.clientY }
        setTime(time => {
          const current = new Date().getTime()
          const newTime = time - x * 6000
          if (newTime > current - 15 * 60 * 1000) {
            return current - 15 * 60 * 1000
          }
          if (newTime < current - 24 * 60 * 60 * 1000) {
            return current - 24 * 60 * 60 * 1000
          }
          return newTime
        })
      }
    }
    const up = () => {
      // document.body.style.cursor = 'default'
      cursor = null
    }

    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])
  const date = useMemo(() => new Date(time), [time])

  const frame = format(date)

  return (
    <main>
      <img className="img" src={url(frame)} alt={frame} />
      <aside>{date.toLocaleString()}</aside>
    </main>
  )
}
