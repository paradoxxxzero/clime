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

  const [pastLimit, setPastLimit] = useState(hours)
  const [infos, setInfos] = useState({})
  const [locationAsked, setLocationAsked] = useState(false)
  const [map, setMap] = useState({
    center: [0, 0],
    zoom: innerHeight / 2,
    time: null,
  })
  const speed = useRef({ center: [0, 0], zoom: 0, time: 0, now: 0 })
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
      setMap(({ center, zoom, time }) => ({
        center,
        zoom,
        time: time ? Math.min(max, Math.max(min, time)) : time,
      }))
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
  }, [infos, loading])

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
      while (time > new Date().getTime() - pastLimit * 60 * 60 * 1000) {
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

        while (time > new Date().getTime() - pastLimit * 60 * 60 * 1000) {
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

      while (time > new Date().getTime() - pastLimit * 60 * 60 * 1000) {
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
              setMap(({ center, zoom, time }) => ({
                center,
                zoom,
                time:
                  !time || Math.abs(time - key) < 5 * 60 * 1000 ? key : time,
              }))
            } finally {
              setLoading(loading => loading - 1)
            }
          })
        )
      }

      rewindCloud()
      rewindRain()
    }

    setMap(({ center, zoom, time }) => {
      toload.sort(
        (a, b) => Math.abs(time - a.timestamp) - Math.abs(time - b.timestamp)
      )

      if (toload.length > 0) {
        loadall()
      }
      return { center, zoom, time }
    })
  }, [infos, pastLimit])

  const rescale = useCallback((delta, x, y) => {
    setMap(({ center, zoom, time }) => {
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
        time,
      }
    })
  }, [])

  useEffect(() => {
    const pointers = new Map()
    let distance = null
    const history = []

    const down = e => {
      document.body.style.cursor = 'grabbing'
      if (e.button !== 0) {
        return
      }
      if (pointers.size === 0) {
        history.length = 0
        speed.center = [0, 0]
        speed.zoom = 0
        speed.time = 0
        speed.now = 0
      }

      pointers.set(e.pointerId, [e.clientX, e.clientY])
      e.preventDefault()
    }

    const move = e => {
      if (!pointers.has(e.pointerId)) {
        return
      }

      const cursor = pointers.get(e.pointerId)
      const dx = ((cursor[0] - e.clientX) * devicePixelRatio) / pointers.size
      const dy = ((cursor[1] - e.clientY) * devicePixelRatio) / pointers.size
      pointers.set(e.pointerId, [e.clientX, e.clientY])

      let t = 0,
        x = 0,
        y = 0

      const timeMode = !e.shiftKey && pointers.size === 1
      if (timeMode) {
        t = dx
      } else {
        x = dx
        y = dy
      }

      if (pointers.size > 1) {
        const vals = pointers.values()
        const p1 = vals.next().value
        const p2 = vals.next().value

        const newDistance = Math.hypot(p1[0] - p2[0], p1[1] - p2[1])
        if (distance === null) {
          distance = newDistance
          return
        }

        const deltaDistance = (newDistance - distance) / innerWidth
        distance = newDistance
        rescale(
          (-deltaDistance * 4) / devicePixelRatio,
          (p1[0] + p2[0]) / 2,
          (p1[1] + p2[1]) / 2
        )
      }
      setMap(({ center, zoom, time }) => {
        const rv = {
          zoom,
          center: [center[0] - x, center[1] - y],
          time:
            time && bounds.current
              ? Math.min(
                  bounds.current[1],
                  Math.max(bounds.current[0], time - t * 15 * 1000)
                )
              : time,
        }
        history.push([performance.now(), rv])
        if (history.length > 50) {
          history.shift()
        }
        return rv
      })
    }
    const up = () => {
      document.body.style.cursor = 'default'
      pointers.clear()
      distance = null
      if (history.length > 5) {
        const [t, map] = history[history.length - 1]
        const [t0, map0] = history[0]
        const dt = t - t0
        speed.current.center = [
          (map.center[0] - map0.center[0]) / dt,
          (map.center[1] - map0.center[1]) / dt,
        ]
        speed.current.zoom = (map.zoom - map0.zoom) / dt
        speed.current.time = (map.time - map0.time) / dt
      }
      history.length = 0
    }

    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [rescale])

  useEffect(() => {
    if (locationAsked) {
      return
    }
    const click = () => {
      setLocationAsked(true)
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          localStorage.setItem(
            'location',
            JSON.stringify([coords.latitude, coords.longitude])
          )
          latlngs.push([coords.latitude, coords.longitude])
          const canvas = canvasRef.current
          draw(cache.current, canvas, map, intrapolate, rainAlpha)
        },
        error => {
          alert('Could not get your location, ' + error.message)
        },
        {
          maximumAge: 30 * 60 * 1000,
        }
      )
    }

    window.addEventListener('click', click)
    return () => {
      window.removeEventListener('click', click)
    }
  }, [map, intrapolate, rainAlpha, locationAsked])

  useEffect(() => {
    const animate = () => {
      const damp = 0.9
      speed.current.center[0] *= damp
      speed.current.center[1] *= damp
      speed.current.zoom *= damp
      speed.current.time *= damp

      const now = performance.now()
      const dt = now - (speed.current.now || now)
      speed.current.now = now
      setMap(({ center, zoom, time }) => ({
        center: [
          center[0] + speed.current.center[0] * dt,
          center[1] + speed.current.center[1] * dt,
        ],
        zoom: zoom + speed.current.zoom * dt,
        time: time + speed.current.time * dt,
      }))
      id = requestAnimationFrame(animate)
    }
    let id = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(id)
  }, [])

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
      draw(cache.current, canvas, map, intrapolate, rainAlpha)
    })
    observer.observe(canvas, { box: ['device-pixel-content-box'] })
    return () => observer.disconnect()
  }, [map, intrapolate, rainAlpha])

  return (
    <main>
      <canvas className="img" ref={canvasRef} />
      <aside>
        <div className="control">
          <button className="button" onClick={() => setPastLimit(h => h + 1)}>
            «
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
          {map.time && new Date(map.time).toLocaleString()}
        </div>
        <div className="loading">{loading > 0 ? `${loading}…` : ''}</div>
      </aside>
    </main>
  )
}
