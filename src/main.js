import './style.css'
import { supabase } from './supabase'
import Chart from 'chart.js/auto'

const $ = (id) => document.getElementById(id)

const authSection = $('auth')
const mainSection = $('main')
const trackerSection = $('tracker')
const notAllowedBox = $('notAllowed')

const email = $('email')
const password = $('password')
const authMsg = $('authMsg')

const btnSignUp = $('btnSignUp')
const btnSignIn = $('btnSignIn')
const btnSignOut = $('btnSignOut')

const dayInput = $('day')
const whoami = $('whoami')

const myCountEl = $('myCount')
const updatedAtEl = $('updatedAt')
const bothCountsEl = $('bothCounts')

const btnPlus = $('btnPlus')
const btnMinus = $('btnMinus')
const setCountInput = $('setCount')
const btnSet = $('btnSet')

const monthRecapCard = $('monthRecapCard')
const monthRecapEl = $('monthRecap')
const yearRecapCard = $('yearRecapCard')
const yearRecapEl = $('yearRecap')

// NUEVO: charts
const monthChartWrap = $('monthChartWrap')
const monthChartCanvas = $('monthChart')
const yearChartWrap = $('yearChartWrap')
const yearChartCanvas = $('yearChart')

let monthChart = null
let yearChart = null

let session = null
let profilesById = new Map()

function todayISO() {
  const d = new Date()
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return tz.toISOString().slice(0, 10)
}

function lastDayOfMonthISO(isoDay) {
  const [y, m] = isoDay.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

function monthRange(isoDay) {
  const [y, m] = isoDay.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { start, end }
}

function yearRange(isoDay) {
  const [y] = isoDay.split('-').map(Number)
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}

function daysOfMonthISO(isoDay) {
  const { start, end } = monthRange(isoDay)
  const days = []
  let d = new Date(`${start}T00:00:00Z`)
  const endD = new Date(`${end}T00:00:00Z`)
  while (d <= endD) {
    days.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

function fmtName(userId) {
  return profilesById.get(userId)?.display_name || userId.slice(0, 8)
}

function cssVars() {
  const cs = getComputedStyle(document.documentElement)
  return {
    text: cs.getPropertyValue('--text').trim() || '#111',
    muted: cs.getPropertyValue('--muted').trim() || '#666',
    border: cs.getPropertyValue('--border').trim() || 'rgba(0,0,0,0.12)',
  }
}

// Paleta discreta (bonita y consistente). No depende de CSS.
function palette(i) {
  const p = [
    { border: 'rgba(59,130,246,0.95)', bg: 'rgba(59,130,246,0.22)' },
    { border: 'rgba(16,185,129,0.95)', bg: 'rgba(16,185,129,0.22)' },
    { border: 'rgba(236,72,153,0.95)', bg: 'rgba(236,72,153,0.20)' },
    { border: 'rgba(245,158,11,0.95)', bg: 'rgba(245,158,11,0.20)' },
  ]
  return p[i % p.length]
}

function destroyChart(ch) {
  if (ch) ch.destroy()
  return null
}

async function isAllowedUser() {
  // RLS permite ver solo tu propia fila en allowed_users; si no estás, retorna []
  const { data, error } = await supabase.from('allowed_users').select('user_id').limit(1)
  if (error) throw error
  return (data || []).length > 0
}

async function loadProfiles() {
  const { data, error } = await supabase.from('profiles').select('user_id, display_name')
  if (error) throw error
  profilesById = new Map((data || []).map((p) => [p.user_id, p]))
}

async function ensureMyProfile() {
  const me = session.user.id
  if (profilesById.has(me)) return

  const display_name = prompt('Pon tu nombre (se verá en los recaps):')
  if (!display_name) return

  const { error } = await supabase.from('profiles').insert({ user_id: me, display_name })
  if (error) throw error

  await loadProfiles()
}

async function fetchDayCounts(isoDay) {
  const { data, error } = await supabase
    .from('cry_days')
    .select('user_id, count, updated_at')
    .eq('day', isoDay)

  if (error) throw error
  return data || []
}

function renderBothCounts(rows) {
  if (!rows.length) {
    bothCountsEl.textContent = 'Aún no hay registros para ese día.'
    return
  }
  const sorted = [...rows].sort((a, b) => a.user_id.localeCompare(b.user_id))
  bothCountsEl.innerHTML = sorted
    .map((r) => `
      <div class="list-row">
        <div class="list-name">${fmtName(r.user_id)}</div>
        <div class="badge">${r.count}</div>
      </div>
    `)
    .join('')
}

function renderMine(rows) {
  const me = session.user.id
  const mine = rows.find((r) => r.user_id === me)
  myCountEl.textContent = mine ? String(mine.count) : '0'
  updatedAtEl.textContent = mine?.updated_at ? `Actualizado: ${new Date(mine.updated_at).toLocaleString()}` : ''

  // Animación breve (CSS: .pulse)
  myCountEl.classList.remove('pulse')
  // eslint-disable-next-line no-unused-expressions
  myCountEl.offsetWidth
  myCountEl.classList.add('pulse')
}

async function fetchRange(startISO, endISO) {
  const { data, error } = await supabase
    .from('cry_days')
    .select('user_id, day, count')
    .gte('day', startISO)
    .lte('day', endISO)

  if (error) throw error
  return data || []
}

function recapHtml(rows) {
  if (!rows.length) return '<div class="subtle">Sin datos todavía.</div>'

  const totals = new Map()
  let grand = 0

  for (const r of rows) {
    totals.set(r.user_id, (totals.get(r.user_id) || 0) + r.count)
    grand += r.count
  }

  const items = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([uid, total]) => `
      <div class="list-row">
        <div class="list-name">${fmtName(uid)}</div>
        <div class="badge">${total}</div>
      </div>
    `)
    .join('')

  return `
    <div class="list">
      ${items}
      <hr />
      <div class="list-row">
        <div class="list-name">Total ambos</div>
        <div class="badge">${grand}</div>
      </div>
    </div>
  `
}

function drawMonthChart(rows, isoDay) {
  if (!monthChartCanvas) return
  monthChart = destroyChart(monthChart)

  const vars = cssVars()
  const days = daysOfMonthISO(isoDay)
  const labels = days.map((d) => String(Number(d.slice(8, 10)))) // 1..31

  // Determina el set de usuarios (ideal: los del perfil)
  const userIds = [...profilesById.keys()].length
    ? [...profilesById.keys()].sort()
    : [...new Set(rows.map((r) => r.user_id))].sort()

  const byUserDay = new Map()
  for (const uid of userIds) byUserDay.set(uid, new Map())
  for (const r of rows) byUserDay.get(r.user_id)?.set(r.day, r.count)

  const datasets = userIds.map((uid, i) => {
    const col = palette(i)
    const map = byUserDay.get(uid) || new Map()
    return {
      label: fmtName(uid),
      data: days.map((d) => map.get(d) || 0),
      backgroundColor: col.bg,
      borderColor: col.border,
      borderWidth: 1,
      borderRadius: 8,
      stack: 'stack1',
    }
  })

  monthChart = new Chart(monthChartCanvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: vars.text, boxWidth: 10, boxHeight: 10 },
        },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: vars.muted },
          grid: { color: vars.border },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: vars.muted, precision: 0 },
          grid: { color: vars.border },
        },
      },
    },
  })
}

function drawYearChart(rows, isoDay) {
  if (!yearChartCanvas) return
  yearChart = destroyChart(yearChart)

  const vars = cssVars()
  const labels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const userIds = [...profilesById.keys()].length
    ? [...profilesById.keys()].sort()
    : [...new Set(rows.map((r) => r.user_id))].sort()

  const totalsByUser = new Map()
  for (const uid of userIds) totalsByUser.set(uid, Array(12).fill(0))

  for (const r of rows) {
    const m = Number(String(r.day).slice(5, 7)) - 1
    const arr = totalsByUser.get(r.user_id)
    if (arr && m >= 0 && m < 12) arr[m] += r.count
  }

  const datasets = userIds.map((uid, i) => {
    const col = palette(i)
    return {
      label: fmtName(uid),
      data: totalsByUser.get(uid) || Array(12).fill(0),
      backgroundColor: col.bg,
      borderColor: col.border,
      borderWidth: 1,
      borderRadius: 10,
      stack: 'stack1',
    }
  })

  yearChart = new Chart(yearChartCanvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: vars.text, boxWidth: 10, boxHeight: 10 },
        },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: vars.muted },
          grid: { color: vars.border },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: vars.muted, precision: 0 },
          grid: { color: vars.border },
        },
      },
    },
  })
}

async function renderRecaps(isoDay) {
  const { start: ms, end: me } = monthRange(isoDay)
  const monthRows = await fetchRange(ms, me)
  monthRecapEl.innerHTML = recapHtml(monthRows)

  const { start: ys, end: ye } = yearRange(isoDay)
  const yearRows = await fetchRange(ys, ye)
  yearRecapEl.innerHTML = recapHtml(yearRows)

  const showMonth = isoDay === lastDayOfMonthISO(isoDay)
  const showYear = isoDay.endsWith('-12-31')

  monthRecapCard.style.display = showMonth ? '' : 'none'
  yearRecapCard.style.display = showYear ? '' : 'none'

  // Charts (solo cuando el card está visible, para sizing correcto)
  if (monthChartWrap) monthChartWrap.style.display = showMonth ? '' : 'none'
  if (yearChartWrap) yearChartWrap.style.display = showYear ? '' : 'none'

  if (showMonth) {
    if (monthRows.length) drawMonthChart(monthRows, isoDay)
    else monthChart = destroyChart(monthChart)
  } else {
    monthChart = destroyChart(monthChart)
  }

  if (showYear) {
    if (yearRows.length) drawYearChart(yearRows, isoDay)
    else yearChart = destroyChart(yearChart)
  } else {
    yearChart = destroyChart(yearChart)
  }
}

async function refreshUI() {
  const isoDay = dayInput.value

  await loadProfiles()
  await ensureMyProfile()

  whoami.innerHTML = `Usuario: <strong>${fmtName(session.user.id)}</strong> — ID: <code>${session.user.id}</code>`

  const rows = await fetchDayCounts(isoDay)
  renderMine(rows)
  renderBothCounts(rows)

  await renderRecaps(isoDay)
}

async function increment(delta) {
  const isoDay = dayInput.value
  const { error } = await supabase.rpc('increment_cry', { p_day: isoDay, p_delta: delta })
  if (error) throw error
  await refreshUI()
}

async function setExactCount(n) {
  const isoDay = dayInput.value
  const { error } = await supabase.rpc('set_cry_count', { p_day: isoDay, p_count: n })
  if (error) throw error
  await refreshUI()
}

// Auth
btnSignUp.addEventListener('click', async () => {
  authMsg.textContent = ''
  const { error } = await supabase.auth.signUp({ email: email.value, password: password.value })
  authMsg.textContent = error
    ? `Error: ${error.message}`
    : 'Cuenta creada. Si tu proyecto requiere confirmación por email, revisa tu correo y confirma.'
})

btnSignIn.addEventListener('click', async () => {
  authMsg.textContent = ''
  const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
  authMsg.textContent = error ? `Error: ${error.message}` : ''
})

btnSignOut.addEventListener('click', async () => {
  await supabase.auth.signOut()
})

dayInput.addEventListener('change', async () => {
  if (session) await refreshUI()
})

btnPlus.addEventListener('click', () => increment(1))
btnMinus.addEventListener('click', () => increment(-1))

btnSet.addEventListener('click', async () => {
  const n = Number(setCountInput.value)
  if (!Number.isFinite(n) || n < 0) return alert('Pon un número válido (>= 0).')
  await setExactCount(n)
  setCountInput.value = ''
})

async function showLoggedInUI() {
  authSection.style.display = 'none'
  mainSection.style.display = ''

  dayInput.value = dayInput.value || todayISO()

  // Verificación explícita de allowlist
  const allowed = await isAllowedUser()
  notAllowedBox.style.display = allowed ? 'none' : ''
  trackerSection.style.display = allowed ? '' : 'none'

  if (allowed) await refreshUI()
}

function showLoggedOutUI() {
  // limpiar charts si se desloguea
  monthChart = destroyChart(monthChart)
  yearChart = destroyChart(yearChart)

  mainSection.style.display = 'none'
  authSection.style.display = ''
  trackerSection.style.display = 'none'
  notAllowedBox.style.display = 'none'
  whoami.textContent = ''
}

async function init() {
  dayInput.value = todayISO()

  const { data } = await supabase.auth.getSession()
  session = data.session

  if (session) await showLoggedInUI()
  else showLoggedOutUI()

  supabase.auth.onAuthStateChange(async (_event, newSession) => {
    session = newSession
    if (session) await showLoggedInUI()
    else showLoggedOutUI()
  })
}

init().catch((e) => {
  console.error(e)
  alert(e.message || String(e))
})