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
  if (time < keys[0]) {
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

export const draw = (
  cache,
  time,
  canvas,
  zoom = 1,
  intrapolate = true,
  rainAlpha = 50
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
  render(cache.cloud.get(cloud.prevTime), 1)
  if (intrapolate) {
    render(cache.cloud.get(cloud.nextTime), 1 - cloud.ratio)
  }
  if (!rainAlpha) {
    return
  }
  render(
    cache.rain.get(rain.prevTime) || cache.forecast.get(rain.prevTime),
    (rainAlpha / 100) * (intrapolate ? rain.ratio : 1)
  )
  if (intrapolate) {
    render(
      cache.rain.get(rain.nextTime) || cache.forecast.get(rain.nextTime),
      (rainAlpha / 100) * (1 - rain.ratio)
    )
  }
}
