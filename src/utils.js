import { latlngs } from './main'

export const getInfos = async () => {
  const res = await fetch('https://imn-api.meteoplaza.com/v4/nowcast/tiles/')
  const data = await res.json()
  return data
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

export const cloudFormat = date =>
  `${date.toISOString().replace(/[-T]/g, '').split(':')[0]}${pad(
    date.getMinutes(),
    2
  )}`
export const rainFormat = date =>
  `${date.toISOString().replace(/[-T]/g, '').split(':')[0]}${pad(
    date.getMinutes(),
    2
  )}`
export const forecastFormat = (date, offset) =>
  `${date.toISOString().replace(/[-T]/g, '').split(':')[0]}${pad(
    date.getMinutes(),
    2
  )}${offset >= 0 ? '+' : '-'}${pad(Math.abs(offset), 3)}`

export const cloudUrl = frame =>
  `https://imn-api.meteoplaza.com/v4/nowcast/tiles/satellite-europe/${frame}/7/41/59/50/70?outputtype=jpeg`

export const rainUrl = frame =>
  `https://imn-api.meteoplaza.com/v4/nowcast/tiles/radar-world/${frame}/7/41/59/50/70?outputtype=image&unit=mm/hr`

export const load = async url => {
  const image = new Image()
  const promise = new Promise((resolve, reject) => {
    // image.onload = () => {
    //   image.decode().then(() => resolve(image))
    // }
    image.onload = () => resolve(image)
    image.onerror = reject
    image.referrerPolicy = 'no-referrer'
    image.src = url
  })

  return promise
}

export const group = (array, size) => {
  return array.reduce((acc, _, i) => {
    if (i % size === 0) {
      acc.push(array.slice(i, i + size))
    }
    return acc
  }, [])
}

// const start = 5
// // const baseFrames = new Array((24 * 60) / 5)
// const baseFrames = new Array((24 * 60) / 5)
//   .fill()
//   .map((_, i) => new Date().getTime() - (5 * i + start) * 60 * 1000)

const getPrevNextRatio = (keys, time) => {
  keys = keys.sort()
  let index
  if (time <= keys[0]) {
    index = 1
  } else if (time > keys[keys.length - 1]) {
    index = keys.length - 1
  } else {
    index = keys.findIndex(key => key >= time)
  }
  const prevTime = keys[index - 1]
  const nextTime = keys[index]

  const ratio =
    time > nextTime
      ? 0
      : time < prevTime
        ? 1
        : (nextTime - time) / (nextTime - prevTime)

  return { prevTime, nextTime, ratio }
}

const deg2rad = deg => deg * (Math.PI / 180)

const bounds = {
  east: 16.875,
  north: 54.1624339680678,
  south: 36.59788913307021,
  west: -14.0625,
}

const getLocalLatLng = () => {
  try {
    const latlng = JSON.parse(localStorage.getItem('location'))
    if (latlng) {
      return [[...latlng, true]]
    }
  } catch (e) {
    // pass
  }
  return []
}

export const draw = (
  cache,
  time,
  canvas,
  { center, zoom },
  intrapolate,
  rainAlpha
) => {
  const ctx = canvas.getContext('2d')

  // Find in cache.cloud the closest previous and next images
  if (cache.cloud.size < 2) {
    return
  }
  const cloud = getPrevNextRatio([...cache.cloud.keys()], time)
  const rain = getPrevNextRatio(
    [...cache.rain.keys(), ...cache.forecast.keys()],
    time
  )

  const img = cache.cloud.get(cloud.prevTime)

  ctx.globalAlpha = 1

  const aspect = img.width / img.height
  let x = center[0]
  let y = center[1]

  let width = 2 * zoom * aspect * devicePixelRatio
  let height = 2 * zoom * devicePixelRatio

  // Translate to center image at 0, 0
  x -= width / 2
  y -= height / 2

  // Translate to center image at canvas center
  x += canvas.width / 2
  y += canvas.height / 2

  img && ctx.drawImage(img, x, y, width, height)

  if (intrapolate) {
    ctx.globalAlpha = 1 - cloud.ratio
    const nextImg = cache.cloud.get(cloud.nextTime)
    if (nextImg) {
      ctx.drawImage(nextImg, x, y, width, height)
    }
  }
  if (rainAlpha) {
    ctx.globalAlpha = (rainAlpha / 100) * (intrapolate ? rain.ratio : 1)
    const rainImg =
      cache.rain.get(rain.prevTime) || cache.forecast.get(rain.prevTime)
    if (rainImg) {
      ctx.drawImage(rainImg, x, y, width, height)
    }
    if (intrapolate) {
      const nextRainImg =
        cache.rain.get(rain.nextTime) || cache.forecast.get(rain.nextTime)
      ctx.globalAlpha = (rainAlpha / 100) * (1 - rain.ratio)
      if (nextRainImg) {
        ctx.drawImage(nextRainImg, x, y, width, height)
      }
    }
  }
  const drawLatLngs = latlngs.length ? latlngs : getLocalLatLng()
  drawLatLngs.forEach(([lat, lng, local], i) => {
    const cWest = x
    const cNorth = y
    const cEast = x + width
    const cSouth = y + height
    const lWest = deg2rad(bounds.west)
    const pNorth = deg2rad(bounds.north)
    const lEast = deg2rad(bounds.east)
    const pSouth = deg2rad(bounds.south)

    // Mercator projection
    // x = R * (λ - λ0)
    // y = R * ln(tan(π/4 + φ/2))

    // xw - xe = R * (λw - λe)
    // R = (xw - xe) / (λw - λe)
    const R = (cEast - cWest) / (lEast - lWest)

    const l0 = lWest - cWest / R
    const cx = R * (deg2rad(lng) - l0)

    const yNorth = R * Math.log(Math.tan(Math.PI / 4 + pNorth / 2))
    const ySouth = R * Math.log(Math.tan(Math.PI / 4 + pSouth / 2))
    const yLat = R * Math.log(Math.tan(Math.PI / 4 + deg2rad(lat) / 2))
    const cy =
      ((yNorth - yLat) / (yNorth - ySouth)) * (cSouth - cNorth) + cNorth

    ctx.globalAlpha = local ? 0.4 : 0.6
    // Draw crosshair
    ctx.fillStyle = ctx.strokeStyle = `hsl(${
      (i * 360) / (latlngs.length + 1)
    }, 100%, 40%)`
    const base = 5 * window.devicePixelRatio
    ctx.lineWidth = base / 2
    ctx.beginPath()
    ctx.moveTo(cx - 2 * base, cy)
    ctx.lineTo(cx - base, cy)
    ctx.moveTo(cx + base, cy)
    ctx.lineTo(cx + 2 * base, cy)
    ctx.moveTo(cx, cy - 2 * base)
    ctx.lineTo(cx, cy - base)
    ctx.moveTo(cx, cy + base)
    ctx.lineTo(cx, cy + 2 * base)
    ctx.stroke()

    // Draw circle
    ctx.beginPath()
    ctx.arc(cx, cy, base, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1)
  })
}
