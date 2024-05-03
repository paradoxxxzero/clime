import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const round5 = num => {
  return Math.floor(num / 5) * 5
}

function pad(num, size) {
  num = num.toString()
  while (num.length < size) num = '0' + num
  return num
}

const roundDate = (date, minutes = 5) => {
  const coeff = 1000 * 60 * minutes
  return new Date(Math.floor(date.getTime() / coeff) * coeff)
}

const format = date =>
  `${date.toISOString().replace(/[-T]/g, '').split(':')[0]}${pad(
    date.getMinutes(),
    2
  )}`

const url = frame =>
  `https://imn-api.meteoplaza.com/v4/nowcast/tiles/satellite-europe/${frame}/7/41/59/50/70?outputtype=jpeg`

const load = async url => {
  const image = new Image()
  image.src = url
  image.referrerPolicy = 'no-referrer'

  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image)
    image.onerror = reject
  })
}

const cache = new Map()
const start = -15
async function preload(setLastFrame) {
  for (
    let t = roundDate(new Date()).getTime() + start * 60 * 1000;
    t > new Date().getTime() - 24 * 60 * 60 * 1000;
    t -= 5 * 60 * 1000
  ) {
    const frame = format(new Date(t))
    cache.set(frame, await load(url(frame)))
    setLastFrame(frame)
  }
}

const draw = (time, canvas, zoom = 1) => {
  const ctx = canvas.getContext('2d')
  const prevDate = roundDate(new Date(time))
  const nextDate = roundDate(new Date(time + 5 * 60 * 1000))
  const prevFrame = format(prevDate)
  const nextFrame = format(nextDate)

  const prevImg = cache.get(prevFrame)
  const nextImg = cache.get(nextFrame)

  const ratio = !prevImg
    ? 1
    : !nextImg
    ? 0
    : (nextDate.getTime() - time) / (nextDate.getTime() - prevDate.getTime())

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const render = (img, alpha) => {
    if (alpha === 0 || !img) {
      return
    }

    const horizontal = innerWidth / innerHeight < img.width / img.height
    const scale =
      zoom * (!horizontal ? innerWidth / img.width : innerHeight / img.height)

    const dx = (canvas.width - img.width * scale) / 2
    const dy = (canvas.height - img.height * scale) / 2

    ctx.globalAlpha = alpha
    ctx.drawImage(img, dx, dy, img.width * scale, img.height * scale)
  }
  render(prevImg, 1)
  render(nextImg, 1 - ratio)
}

export default function App() {
  const [time, setTime] = useState(
    () => new Date().getTime() + start * 60 * 1000
  )
  const [zoom, setZoom] = useState(devicePixelRatio)
  const [lastFrame, setLastFrame] = useState(null)

  useEffect(() => {
    preload(setLastFrame)
  }, [])

  const canvasRef = useRef()

  useEffect(() => {
    let cursor
    const down = e => {
      document.body.style.cursor = 'grabbing'
      cursor = { x: e.clientX, y: e.clientY }
      e.preventDefault()
    }

    const move = e => {
      if (cursor) {
        const x = cursor.x - e.clientX
        const y = cursor.y - e.clientY
        cursor = { x: e.clientX, y: e.clientY }
        setTime(time => time - x * 6000)
      }
    }
    const up = () => {
      document.body.style.cursor = 'default'
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

  useEffect(() => {
    const wheel = e => {
      setZoom(zoom => zoom + e.deltaY / innerHeight)
    }
    window.addEventListener('wheel', wheel)
    return () => window.removeEventListener('wheel', wheel)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const observer = new ResizeObserver(entries => {
      const entry = entries.find(entry => entry.target === canvas)
      canvas.width = entry.devicePixelContentBoxSize[0].inlineSize
      canvas.height = entry.devicePixelContentBoxSize[0].blockSize

      draw(time, canvas, zoom)
    })
    observer.observe(canvas, { box: ['device-pixel-content-box'] })
    return () => observer.disconnect()
  }, [time, zoom, lastFrame])

  return (
    <main>
      <canvas className="img" ref={canvasRef} />
      <aside>{new Date(time).toLocaleString()}</aside>
    </main>
  )
}
