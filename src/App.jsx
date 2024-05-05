import { useEffect, useRef, useState } from 'react'
import './App.css'
import {
  cloudFormat,
  cloudUrl,
  draw,
  forecastFormat,
  getInfos,
  group,
  load,
  rainFormat,
  rainUrl,
} from './utils'

const prevHours = location.search.match(/prev=(\d+)/)?.[1] || 5

export default function App() {
  const cache = useRef({
    cloud: new Map(),
    rain: new Map(),
    forecast: new Map(),
  })
  const canvasRef = useRef()
  const locks = useRef({})
  const bounds = useRef()

  const [infos, setInfos] = useState({})
  const [time, setTime] = useState(() => new Date().getTime())
  const [zoom, setZoom] = useState(devicePixelRatio)
  const [loading, setLoading] = useState(0)
  const [intrapolate, setIntrapolate] = useState(true)
  const [rainAlpha, setRainAlpha] = useState(50)

  useEffect(() => {
    async function fetchInfos() {
      const data = await getInfos()
      setInfos(data)
      const ts = data['satellite-europe']?.layers
        ?.map(({ timestamp }) => timestamp * 1000)
        .concat(
          data['radar-world']?.layers?.map(({ timestamp }) => timestamp * 1000)
        )
        .concat([...cache.current.cloud.keys()])
      const [min, max] = [Math.min(...ts), Math.max(...ts)]
      bounds.current = [min, max]
      setTime(time => Math.min(max, Math.max(min, time)))
    }
    fetchInfos()
  }, [])

  useEffect(() => {
    // Cloud images
    const toload = []
    console.log(infos)
    infos['satellite-europe']?.layers?.forEach(({ layername, timestamp }) => {
      if (!cache.current.cloud.has(timestamp)) {
        toload.push({
          type: 'cloud',
          key: timestamp * 1000,
          url: cloudUrl(layername),
        })
      }
    })

    // Rain images
    infos['radar-world']?.layers?.forEach(({ layername, timestamp, type }) => {
      if (!cache.current.rain.has(timestamp)) {
        toload.push({
          type: type === 'forecast' ? type : 'rain',
          key: timestamp * 1000,
          url: rainUrl(layername),
        })
      }
    })
    toload.sort((a, b) => b.timestamp - a.timestamp)

    async function rewindCloud() {
      if (locks.current.rewindCloud) {
        return
      }
      locks.current.rewindCloud = true
      const keys = [...cache.current.cloud.keys()].sort()
      if (keys.length === 0) {
        return
      }
      let time = keys[0]
      while (time > new Date().getTime() - prevHours * 60 * 60 * 1000) {
        time -= 5 * 60 * 1000
        setLoading(loading => loading + 1)
        if (!cache.current.cloud.has(time)) {
          try {
            cache.current.cloud.set(
              time,
              await load(cloudUrl(cloudFormat(new Date(time))))
            )
            bounds.current[0] = Math.min(bounds.current[0], time)
          } catch (e) {
            locks.current.rewindCloud = false
            return
          } finally {
            setLoading(loading => loading - 1)
          }
        }
      }
      locks.current.rewindCloud = false
    }

    async function rewindRain() {
      if (locks.current.rewindRain) {
        return
      }
      locks.current.rewindRain = true

      let keys = [...cache.current.rain.keys()].sort()
      let time
      if (keys.length === 0) {
        keys = [...cache.current.forecast.keys()].sort()
        if (keys.length === 0) {
          return
        }
        const runtime = infos['radar-world'].runtimes[0] * 1000
        time = keys[0]

        while (time > new Date().getTime() - prevHours * 60 * 60 * 1000) {
          time -= 5 * 60 * 1000
          if (!cache.current.rain.has(time)) {
            setLoading(loading => loading + 1)
            try {
              cache.current.rain.set(
                time,
                await load(
                  rainUrl(
                    forecastFormat(
                      new Date(runtime),
                      (time - runtime) / (60 * 1000)
                    )
                  )
                )
              )
              bounds.current[0] = Math.min(bounds.current[0], time)
            } catch (e) {
              break
            } finally {
              setLoading(loading => loading - 1)
            }
          }
        }
      }
      time = keys[0]

      while (time > new Date().getTime() - prevHours * 60 * 60 * 1000) {
        time -= 5 * 60 * 1000
        if (!cache.current.rain.has(time)) {
          setLoading(loading => loading + 1)
          try {
            cache.current.rain.set(
              time,
              await load(rainUrl(rainFormat(new Date(time))))
            )
            bounds.current[0] = Math.min(bounds.current[0], time)
          } catch (e) {
            locks.current.rewindRain = false
            return
          } finally {
            setLoading(loading => loading - 1)
          }
        }
      }
      locks.current.rewindRain = false
    }

    async function loadall() {
      setLoading(loading => loading + toload.length)
      const batches = group(toload, 5)
      for (const batch of batches) {
        await Promise.all(
          batch.map(async ({ type, key, url }) => {
            try {
              cache.current[type].set(key, await load(url))
              if (Math.abs(time - key) < 5 * 60 * 1000) {
                const canvas = canvasRef.current
                draw(cache.current, time, canvas, zoom)
              }
            } finally {
              setLoading(loading => loading - 1)
            }
          })
        )
      }

      rewindCloud()
      rewindRain()
    }
    if (toload.length > 0) {
      loadall()
    }
  }, [infos])

  useEffect(() => {
    const pointers = new Map()
    // let pinch = null
    let distance = null
    const down = e => {
      document.body.style.cursor = 'grabbing'
      if (e.button !== 0) {
        return
      }

      pointers.set(e.pointerId, [e.clientX, e.clientY])
      e.preventDefault()
    }

    const move = e => {
      if (!pointers.has(e.pointerId)) {
        return
      }
      const cursor = pointers.get(e.pointerId)

      const x = cursor[0] - e.clientX
      const y = cursor[1] - e.clientY
      pointers.set(e.pointerId, [e.clientX, e.clientY])

      if (pointers.size > 1) {
        const vals = pointers.values()
        const p1 = vals.next().value
        const p2 = vals.next().value
        // if (pinch === null) {
        //   pinch = [
        //     (p1[0] + p2[0]) / (2 * window.innerWidth),
        //     (p1[1] + p2[1]) / (2 * window.innerHeight),
        //   ]
        // }

        const newDistance = Math.hypot(p1[0] - p2[0], p1[1] - p2[1])
        if (distance === null) {
          distance = newDistance
          return
        }

        const deltaDistance = (newDistance - distance) / window.innerWidth
        distance = newDistance
        setZoom(zoom => zoom * (1 + deltaDistance * 2))
        return
      }
      if (bounds.current) {
        const [min, max] = bounds.current
        setTime(time => Math.min(max, Math.max(min, time - x * 10000)))
      }
    }
    const up = () => {
      document.body.style.cursor = 'default'
      pointers.clear()
      distance = null
      // pinch = null
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
      setZoom(zoom => Math.pow(1.1, -e.deltaY / 100) * zoom)
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

      draw(cache.current, time, canvas, zoom, intrapolate, rainAlpha)
    })
    observer.observe(canvas, { box: ['device-pixel-content-box'] })
    return () => observer.disconnect()
  }, [time, zoom, intrapolate, rainAlpha])

  return (
    <main>
      <canvas className="img" ref={canvasRef} />
      <aside>
        <div className="control">
          <button className="button" onClick={() => setIntrapolate(i => !i)}>
            {intrapolate ? 'N' : 'I'}
          </button>
          <button
            className="button"
            onClick={() => setRainAlpha(a => (a + 10) % 100)}
          >
            R:{rainAlpha}%
          </button>
        </div>
        <div className="current-time">
          {time && new Date(time).toLocaleString()}
        </div>
        <div className="loading">{loading > 0 ? `${loading}…` : ''}</div>
      </aside>
    </main>
  )
}
