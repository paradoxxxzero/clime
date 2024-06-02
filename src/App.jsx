import { useCallback, useEffect, useRef, useState } from 'react'
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
import { hours, latlngs } from './main'

export default function App() {
  const cache = useRef({
    cloud: new Map(),
    rain: new Map(),
    forecast: new Map(),
  })
  const canvasRef = useRef()
  const locks = useRef({})
  const bounds = useRef()
  const speed = useRef([0, 0, 0])

  const [infos, setInfos] = useState({})
  const [time, setTime] = useState(() => new Date().getTime())
  const [map, setMap] = useState({ center: [0, 0], zoom: innerHeight / 2 })
  const [loading, setLoading] = useState(0)
  const [scrollTime, setScrollTime] = useState(true)
  const [intrapolate, setIntrapolate] = useState(true)
  const [rainAlpha, setRainAlpha] = useState(50)

  useEffect(() => {
    async function fetchInfos() {
      console.log('Fetching')
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
    let timeout = null
    if (!loading) {
      if (!Object.keys(infos).length) {
        fetchInfos()
      } else {
        timeout = setTimeout(() => fetchInfos(), 30000)
      }
    }
    return () => {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }, [loading])

  useEffect(() => {
    // Cloud images
    const toload = []
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
      while (time > new Date().getTime() - hours * 60 * 60 * 1000) {
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

        while (time > new Date().getTime() - hours * 60 * 60 * 1000) {
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

      while (time > new Date().getTime() - hours * 60 * 60 * 1000) {
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
              setTime(time => {
                if (Math.abs(time - key) < 5 * 60 * 1000) {
                  return key
                }
                return time
              })
            } finally {
              setLoading(loading => loading - 1)
            }
          })
        )
      }

      rewindCloud()
      rewindRain()
    }

    setTime(time => {
      toload.sort(
        (a, b) => Math.abs(time - a.timestamp) - Math.abs(time - b.timestamp)
      )

      if (toload.length > 0) {
        loadall()
      }
      return time
    })
  }, [infos])

  const rescale = useCallback((delta, x, y) => {
    setMap(({ center, zoom }) => {
      const aspect = innerWidth / innerHeight

      const dx = -(x - innerWidth / 2 - center[0]) / (2 * zoom * aspect)
      const dy = -(y - innerHeight / 2 - center[1]) / (2 * zoom)

      // Increase half size by delta percent
      return {
        zoom: zoom * (1 - delta),
        center: [
          center[0] - dx * zoom * delta * 2 * aspect,
          center[1] - dy * zoom * delta * 2,
        ],
      }
    })
  }, [])

  useEffect(() => {
    const pointers = new Map()
    let pinch = null
    let distance = null
    const down = e => {
      document.body.style.cursor = 'grabbing'
      if (e.button !== 0) {
        return
      }

      pointers.set(e.pointerId, [e.clientX, e.clientY, performance.now()])
      e.preventDefault()
    }

    const move = e => {
      if (!pointers.has(e.pointerId)) {
        return
      }
      const cursor = pointers.get(e.pointerId)

      const x = (cursor[0] - e.clientX) * devicePixelRatio
      const y = (cursor[1] - e.clientY) * devicePixelRatio
      const t = performance.now()
      speed.current = [
        (speed.current[0] + (1000 * x) / t) / 2,
        (speed.current[1] + (1000 * y) / t) / 2,
        t,
      ]
      pointers.set(e.pointerId, [e.clientX, e.clientY, t])

      if (pointers.size > 1) {
        const vals = pointers.values()
        const p1 = vals.next().value
        const p2 = vals.next().value
        if (pinch === null) {
          pinch = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
        }

        const newDistance = Math.hypot(p1[0] - p2[0], p1[1] - p2[1])
        if (distance === null) {
          distance = newDistance
          return
        }

        const deltaDistance = (newDistance - distance) / innerWidth
        distance = newDistance
        rescale((-deltaDistance * 4) / devicePixelRatio, pinch[0], pinch[1])
        return
      }
      if (scrollTime) {
        if (bounds.current) {
          const [min, max] = bounds.current
          setTime(time => Math.min(max, Math.max(min, time - x * 15 * 1000)))
        }
      } else {
        setMap(({ center, zoom }) => ({
          zoom,
          center: [center[0] - x, center[1] - y],
        }))
      }
    }
    const up = () => {
      document.body.style.cursor = 'default'
      pointers.clear()
      distance = null
      pinch = null
    }

    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [scrollTime, rescale])

  useEffect(() => {
    if (latlngs.length) {
      return
    }
    const dbl = () => {
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        latlngs.push([coords.latitude, coords.longitude])
        const canvas = canvasRef.current
        draw(cache.current, time, canvas, map, intrapolate, rainAlpha)
      })
    }

    window.addEventListener('dblclick', dbl)
    return () => {
      window.removeEventListener('dblclick', dbl)
    }
  }, [time, map, intrapolate, rainAlpha])

  useEffect(() => {
    const animate = () => {
      const now = performance.now()
      const dt = now - (speed.current[2] || now)
      speed.current[2] = now
      const [x, y] = speed.current
      if (Math.abs(x) < 0.001 && Math.abs(y) < 0.001) {
        return
      }
      speed.current[0] *= 0.98
      speed.current[1] *= 0.98
      if (scrollTime) {
        if (bounds.current) {
          const [min, max] = bounds.current
          setTime(time =>
            Math.min(max, Math.max(min, time - x * dt * 15 * 1000))
          )
        }
      } else {
        setMap(({ center, zoom }) => ({
          zoom,
          center: [center[0] - x * dt, center[1] - y * dt],
        }))
      }
      id = requestAnimationFrame(animate)
    }
    let id = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(id)
  }, [scrollTime, time, map])

  useEffect(() => {
    const wheel = e => {
      const delta = e.deltaY / innerWidth
      rescale(delta, e.clientX, e.clientY)
    }
    window.addEventListener('wheel', wheel)
    return () => window.removeEventListener('wheel', wheel)
  }, [rescale])

  useEffect(() => {
    const canvas = canvasRef.current
    const observer = new ResizeObserver(entries => {
      const entry = entries.find(entry => entry.target === canvas)
      canvas.width = entry.devicePixelContentBoxSize[0].inlineSize
      canvas.height = entry.devicePixelContentBoxSize[0].blockSize

      draw(cache.current, time, canvas, map, intrapolate, rainAlpha)
    })
    observer.observe(canvas, { box: ['device-pixel-content-box'] })
    return () => observer.disconnect()
  }, [time, map, intrapolate, rainAlpha])

  return (
    <main>
      <canvas className="img" ref={canvasRef} />
      <aside>
        <div className="control">
          <button className="button" onClick={() => setScrollTime(s => !s)}>
            {scrollTime ? 'T' : 'X'}
          </button>
          <button className="button" onClick={() => setIntrapolate(i => !i)}>
            {intrapolate ? 'I' : 'P'}
          </button>
          <button
            className="button"
            onClick={() => setRainAlpha(a => (a + 10) % 110)}
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
